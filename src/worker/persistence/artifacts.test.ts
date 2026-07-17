// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { promoteScreenshot, retrieveSavedArtifact, rollbackPromotions } from "./artifacts";

const artifactId = "123e4567-e89b-42d3-a456-426614174000";
const investigationId = "223e4567-e89b-42d3-a456-426614174000";

describe("saved R2 artifact lifecycle", () => {
  it("promotes a valid transient screenshot into the private saved namespace", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const bucket = {
      get: vi.fn().mockResolvedValue({
        body: new ReadableStream(),
        httpMetadata: { contentType: "image/webp" },
        customMetadata: { expiresAt: "2026-07-18T00:00:00.000Z" },
        arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
      }),
      put,
    } as unknown as R2Bucket;
    const result = await promoteScreenshot({
      bucket,
      investigationId,
      artifact: {
        id: artifactId,
        type: "screenshot",
        label: "Browser screenshot",
        createdAt: "2026-07-17T00:00:00.000Z",
      },
      now: new Date("2026-07-17T00:00:00.000Z"),
    });
    expect(result.warning).toBeUndefined();
    expect(result.row).toMatchObject({
      r2_key: `saved-artifacts/${investigationId}/${artifactId}.image`,
      size_bytes: 3,
      expires_at: "2026-08-16T00:00:00.000Z",
    });
    expect(put).toHaveBeenCalledOnce();
    const [key, bytes, options] = put.mock.calls[0] as unknown as [
      string,
      ArrayBuffer,
      { customMetadata: Record<string, string> },
    ];
    expect(key).toBe(`saved-artifacts/${investigationId}/${artifactId}.image`);
    expect(bytes).toBeInstanceOf(ArrayBuffer);
    expect(options.customMetadata).toMatchObject({
      savedInvestigationId: investigationId,
      artifactId,
    });
  });

  it("saves without the artifact and emits a warning when promotion is unavailable", async () => {
    const result = await promoteScreenshot({
      investigationId,
      artifact: { id: artifactId, type: "screenshot", label: "Browser screenshot" },
      now: new Date(),
    });
    expect(result.row).toBeUndefined();
    expect(result.warning).toMatch(/unavailable/i);
  });

  it("authorizes an exact D1-associated key and rejects expired metadata", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    const bucket = {
      get: vi.fn().mockResolvedValue({ body, size: 1, httpEtag: '"etag"' }),
    } as unknown as R2Bucket;
    const row = {
      investigation_id: investigationId,
      artifact_id: artifactId,
      r2_key: `saved-artifacts/${investigationId}/${artifactId}.image`,
      artifact_type: "screenshot" as const,
      content_type: "image/webp" as const,
      size_bytes: 1,
      created_at: "2026-07-17T00:00:00.000Z",
      expires_at: "2026-08-16T00:00:00.000Z",
    };
    const response = await retrieveSavedArtifact(bucket, row, new Date("2026-07-18T00:00:00.000Z"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    await expect(
      retrieveSavedArtifact(bucket, row, new Date("2026-08-17T00:00:00.000Z")),
    ).rejects.toMatchObject({ publicError: { code: "share_unavailable" } });
  });

  it("rolls back promoted keys after a database failure", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    await rollbackPromotions({ delete: remove } as unknown as R2Bucket, [
      {
        investigation_id: investigationId,
        artifact_id: artifactId,
        r2_key: "saved-artifacts/private.image",
        artifact_type: "screenshot",
        content_type: "image/png",
        size_bytes: 1,
        created_at: "2026-07-17T00:00:00.000Z",
        expires_at: "2026-08-17T00:00:00.000Z",
      },
    ]);
    expect(remove).toHaveBeenCalledWith(["saved-artifacts/private.image"]);
  });
});
