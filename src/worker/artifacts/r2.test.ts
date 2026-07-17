// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  ArtifactStorageError,
  type BrowserArtifactStore,
  R2BrowserArtifactStore,
  retrieveScreenshotArtifact,
  UnavailableBrowserArtifactStore,
} from "./r2";
import { BROWSER_LIMITS } from "../browser/limits";

const artifactId = "123e4567-e89b-42d3-a456-426614174000";

describe("browser R2 artifacts", () => {
  it("stores a bounded screenshot under an opaque derived key", async () => {
    const put = vi.fn().mockResolvedValue({});
    const bucket = { put } as unknown as R2Bucket;
    const store = new R2BrowserArtifactStore(
      bucket,
      () => new Date("2026-07-17T12:00:00.000Z"),
      () => artifactId,
    );
    const artifact = await store.storeScreenshot({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/jpeg",
      capturedAt: "2026-07-17T12:00:00.000Z",
      finalUrl: "https://example.com/private-path?token=redacted",
      readiness: "loaded",
    });

    expect(put).toHaveBeenCalledWith(
      "browser-screenshots/" + artifactId + ".image",
      expect.any(Uint8Array),
      expect.objectContaining({
        httpMetadata: { contentType: "image/jpeg" },
        customMetadata: {
          expiresAt: "2026-07-18T12:00:00.000Z",
          capturedAt: "2026-07-17T12:00:00.000Z",
          readiness: "loaded",
        },
      }),
    );
    expect(artifact).toMatchObject({
      id: artifactId,
      storage: "r2",
      access: "worker-mediated",
      url: "/api/v1/artifacts/screenshots/" + artifactId,
      sizeBytes: 3,
    });
  });

  it("rejects oversized screenshot data before writing", async () => {
    const put = vi.fn();
    const store = new R2BrowserArtifactStore(
      { put } as unknown as R2Bucket,
      () => new Date(),
      () => artifactId,
    );
    await expect(
      store.storeScreenshot({
        bytes: new Uint8Array(BROWSER_LIMITS.maximumScreenshotBytes + 1),
        contentType: "image/jpeg",
        capturedAt: new Date().toISOString(),
        finalUrl: "https://example.com/",
        readiness: "loaded",
      }),
    ).rejects.toMatchObject({ code: "size_limit" } satisfies Partial<ArtifactStorageError>);
    expect(put).not.toHaveBeenCalled();
  });

  it("returns structured storage failures for missing bindings and R2 writes", async () => {
    const unavailable: BrowserArtifactStore = new UnavailableBrowserArtifactStore();
    await expect(
      unavailable.storeScreenshot({
        bytes: new Uint8Array([1]),
        contentType: "image/jpeg",
        capturedAt: new Date().toISOString(),
        finalUrl: "https://example.com/",
        readiness: "loaded",
      }),
    ).rejects.toMatchObject({ code: "binding_unavailable" });

    const failing = new R2BrowserArtifactStore(
      { put: vi.fn().mockRejectedValue(new Error("R2 unavailable")) } as unknown as R2Bucket,
      () => new Date(),
      () => artifactId,
    );
    await expect(
      failing.storeScreenshot({
        bytes: new Uint8Array([1]),
        contentType: "image/jpeg",
        capturedAt: new Date().toISOString(),
        finalUrl: "https://example.com/",
        readiness: "partial",
      }),
    ).rejects.toMatchObject({ code: "write_failed" });
  });

  it("retrieves only live artifacts with safe response headers", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    const bucket = {
      get: vi.fn().mockResolvedValue({
        body,
        size: 3,
        httpEtag: '"etag"',
        httpMetadata: { contentType: "image/jpeg" },
        customMetadata: { expiresAt: "2026-07-18T12:00:00.000Z" },
      }),
    } as unknown as R2Bucket;
    const response = await retrieveScreenshotArtifact(
      bucket,
      artifactId,
      new Date("2026-07-17T12:00:00.000Z"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("hides malformed, missing, and expired artifact identifiers", async () => {
    const missing = { get: vi.fn().mockResolvedValue(null) } as unknown as R2Bucket;
    expect((await retrieveScreenshotArtifact(missing, "not-a-key")).status).toBe(404);
    expect((await retrieveScreenshotArtifact(missing, artifactId)).status).toBe(404);

    const expiredBody = new ReadableStream();
    const expired = {
      get: vi.fn().mockResolvedValue({
        body: expiredBody,
        size: 1,
        httpEtag: '"etag"',
        httpMetadata: { contentType: "image/jpeg" },
        customMetadata: { expiresAt: "2026-07-16T12:00:00.000Z" },
      }),
    } as unknown as R2Bucket;
    expect(
      (await retrieveScreenshotArtifact(expired, artifactId, new Date("2026-07-17T12:00:00.000Z")))
        .status,
    ).toBe(410);
  });
});
