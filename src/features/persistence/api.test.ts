import { describe, expect, it, vi } from "vitest";
import { investigationById } from "../../data/investigations";
import { saveInvestigation, getSharedReport } from "./api";

describe("persistence client", () => {
  it("sends validated snapshots with installation credentials", async () => {
    const investigation = investigationById.get("fast-cached")!;
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        saved: {
          summary: {
            id: "11111111-1111-4111-8111-111111111111",
            sourceInvestigationId: investigation.id,
            title: investigation.title,
            requestedUrl: investigation.url,
            hostname: "www.cloudflare.com",
            status: "completed",
            sourceType: "recorded",
            schemaVersion: 1,
            investigationHash: "a".repeat(64),
            findingCounts: { high: 0, medium: 0, low: 0, info: 1 },
            hasAiDiagnosis: false,
            hasCounterfactual: false,
            hasScreenshot: false,
            createdAt: investigation.createdAt,
            completedAt: investigation.completedAt,
            savedAt: investigation.createdAt,
            updatedAt: investigation.createdAt,
          },
          investigation,
          artifacts: [],
          label: "SAVED INVESTIGATION",
          freshnessNotice: "This evidence is a captured snapshot.",
        },
        duplicate: false,
        warnings: [],
      }),
    );
    await saveInvestigation({ investigation, preserveScreenshot: false }, fetcher);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/saved-investigations",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("does not retry or replace an unavailable shared report with fixture data", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: { code: "share_revoked", message: "Revoked.", retryable: false } },
          { status: 410 },
        ),
      );
    await expect(getSharedReport("a".repeat(43), fetcher)).rejects.toMatchObject({
      details: { code: "share_revoked" },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
