import { describe, expect, it } from "vitest";
import { investigationById } from "../../data/investigations";
import { PersistenceError } from "./errors";
import {
  deserializeInvestigation,
  serializeSaveRequest,
  stableStringify,
  verifyStoredHash,
} from "./serialization";

const cached = investigationById.get("fast-cached")!;

describe("persisted investigation serialization", () => {
  it("is stable, strips transient artifact URLs, and produces a versioned hash", async () => {
    const withArtifact = {
      ...cached,
      artifacts: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          type: "screenshot" as const,
          label: "Browser screenshot",
          url: "/api/v1/artifacts/screenshots/11111111-1111-4111-8111-111111111111",
          contentType: "image/webp" as const,
          createdAt: cached.createdAt,
        },
      ],
    };
    const result = await serializeSaveRequest({
      investigation: withArtifact,
      preserveScreenshot: true,
    });
    expect(result.schemaVersion).toBe(1);
    expect(result.investigationHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.serialized).not.toContain("/api/v1/artifacts");
    expect(result.investigation.artifacts[0]?.url).toBeUndefined();
    await expect(
      verifyStoredHash(result.investigation, result.investigationHash),
    ).resolves.toBeUndefined();
  });

  it("sorts object keys recursively for repeatable hashes", () => {
    expect(stableStringify({ z: 1, nested: { b: 2, a: 1 }, a: 0 })).toBe(
      '{"a":0,"nested":{"a":1,"b":2},"z":1}',
    );
  });

  it("detects stored-data changes and unsupported schema versions", async () => {
    const result = await serializeSaveRequest({ investigation: cached, preserveScreenshot: false });
    await expect(
      verifyStoredHash({ ...result.investigation, title: "Changed" }, result.investigationHash),
    ).rejects.toMatchObject({ publicError: { code: "invalid_saved_investigation" } });
    expect(() => deserializeInvestigation(result.serialized, 99)).toThrow(PersistenceError);
  });

  it("rejects snapshots above the bounded D1 JSON limit", async () => {
    const oversized = structuredClone(cached);
    oversized.stages[0]!.evidence[0]!.value = "x".repeat(910_000);
    await expect(
      serializeSaveRequest({ investigation: oversized, preserveScreenshot: false }),
    ).rejects.toMatchObject({ publicError: { code: "serialization_too_large" } });
  });
});
