import { describe, expect, it } from "vitest";
import { investigationById } from "../../data/investigations";
import type { SavedInvestigationSummary } from "../../features/persistence/schema";
import { savedDetail, sharedProjection } from "./projection";
import { serializeSaveRequest } from "./serialization";
import type { InvestigationRow, ShareRow, StoredInvestigation } from "./types";

async function stored(): Promise<StoredInvestigation> {
  const source = structuredClone(investigationById.get("fast-cached")!);
  source.url = "https://www.cloudflare.com/?private=value#fragment";
  source.normalizedUrl = source.url;
  source.artifacts = [
    {
      id: "22222222-2222-4222-8222-222222222222",
      type: "screenshot",
      label: "Browser screenshot",
      storage: "r2",
      contentType: "image/webp",
      createdAt: source.createdAt,
      url: "/api/v1/artifacts/screenshots/22222222-2222-4222-8222-222222222222",
    },
  ];
  const serialized = await serializeSaveRequest({
    investigation: source,
    preserveScreenshot: false,
  });
  const summary: SavedInvestigationSummary = {
    id: "11111111-1111-4111-8111-111111111111",
    sourceInvestigationId: source.id,
    title: source.title,
    requestedUrl: "https://www.cloudflare.com/",
    hostname: "www.cloudflare.com",
    status: "completed",
    sourceType: "recorded",
    schemaVersion: 1,
    investigationHash: serialized.investigationHash,
    findingCounts: { high: 0, medium: 0, low: 0, info: 1 },
    hasAiDiagnosis: false,
    hasCounterfactual: false,
    hasScreenshot: true,
    createdAt: source.createdAt,
    completedAt: source.completedAt,
    savedAt: source.createdAt,
    updatedAt: source.createdAt,
  };
  const row: InvestigationRow = {
    id: summary.id,
    owner_id: "owner-secret",
    source_investigation_id: source.id,
    title: source.title,
    requested_url: summary.requestedUrl,
    final_url: null,
    hostname: summary.hostname,
    status: "completed",
    source_type: "recorded",
    schema_version: 1,
    investigation_json: serialized.serialized,
    investigation_hash: serialized.investigationHash,
    high_findings: 0,
    medium_findings: 0,
    low_findings: 0,
    info_findings: 1,
    has_ai_diagnosis: 0,
    has_counterfactual: 0,
    has_screenshot: 1,
    created_at: source.createdAt,
    completed_at: source.completedAt ?? null,
    saved_at: source.createdAt,
    updated_at: source.createdAt,
  };
  return {
    row,
    summary,
    investigation: serialized.investigation,
    artifactRows: [
      {
        investigation_id: summary.id,
        artifact_id: "22222222-2222-4222-8222-222222222222",
        r2_key: "saved-artifacts/internal/private.image",
        artifact_type: "screenshot",
        content_type: "image/webp",
        size_bytes: 100,
        created_at: source.createdAt,
        expires_at: "2026-08-01T00:00:00.000Z",
      },
    ],
  };
}

function share(includeScreenshot: boolean): ShareRow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    investigation_id: "11111111-1111-4111-8111-111111111111",
    token_hash: "secret-hash",
    include_ai_diagnosis: 0,
    include_counterfactual: 0,
    include_screenshot: includeScreenshot ? 1 : 0,
    created_at: "2026-07-17T00:00:00.000Z",
    expires_at: null,
    revoked_at: null,
    last_accessed_at: null,
    access_count: 0,
  };
}

describe("saved and shared projections", () => {
  it("replaces transient artifacts with an owner-authorized route", async () => {
    const detail = savedDetail(await stored());
    expect(detail.artifacts[0]?.url).toContain("/saved-investigations/");
    expect(JSON.stringify(detail)).not.toContain("saved-artifacts/internal");
    expect(JSON.stringify(detail)).not.toContain("owner-secret");
  });

  it("omits screenshots by policy and sanitizes public URL parameters", async () => {
    const report = sharedProjection(await stored(), share(false), "a".repeat(43));
    expect(report.label).toBe("SAVED SNAPSHOT");
    expect(report.access).toBe("READ ONLY");
    expect(report.artifacts).toEqual([]);
    expect(report.investigation.url).toBe("https://www.cloudflare.com/");
    expect(JSON.stringify(report)).not.toMatch(
      /private=value|owner-secret|secret-hash|saved-artifacts/,
    );
    expect(report.runtimeLimitations.length).toBeGreaterThan(0);
  });

  it("uses the controlled shared-artifact route only when explicitly included", async () => {
    const report = sharedProjection(await stored(), share(true), "a".repeat(43));
    expect(report.artifacts[0]?.url).toContain("/shared-reports/");
    expect(report.investigation.artifacts[0]?.url).toBe(report.artifacts[0]?.url);
  });
});
