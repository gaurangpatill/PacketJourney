import type { ArtifactReference } from "../../features/investigation/schema";
import { BROWSER_LIMITS } from "../browser/limits";

const SCREENSHOT_PREFIX = "browser-screenshots/";
const ARTIFACT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface StoredScreenshotInput {
  bytes: Uint8Array;
  contentType: "image/webp" | "image/jpeg" | "image/png";
  capturedAt: string;
  finalUrl: string;
  readiness: "loaded" | "dom-content-loaded" | "partial";
}

export interface BrowserArtifactStore {
  storeScreenshot(input: StoredScreenshotInput): Promise<ArtifactReference>;
}

export class ArtifactStorageError extends Error {
  constructor(
    message: string,
    readonly code: "binding_unavailable" | "size_limit" | "write_failed",
  ) {
    super(message);
    this.name = "ArtifactStorageError";
  }
}

function screenshotKey(id: string): string {
  return `${SCREENSHOT_PREFIX}${id}.image`;
}

export class UnavailableBrowserArtifactStore implements BrowserArtifactStore {
  storeScreenshot(): Promise<ArtifactReference> {
    return Promise.reject(
      new ArtifactStorageError("Screenshot storage is unavailable.", "binding_unavailable"),
    );
  }
}

export class R2BrowserArtifactStore implements BrowserArtifactStore {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  async storeScreenshot(input: StoredScreenshotInput): Promise<ArtifactReference> {
    if (input.bytes.byteLength > BROWSER_LIMITS.maximumScreenshotBytes) {
      throw new ArtifactStorageError(
        "The screenshot exceeded the artifact size limit.",
        "size_limit",
      );
    }
    const id = this.createId();
    if (!ARTIFACT_ID.test(id)) {
      throw new ArtifactStorageError(
        "The artifact identifier could not be generated.",
        "write_failed",
      );
    }
    const expiresAt = new Date(
      this.now().getTime() + BROWSER_LIMITS.screenshotRetentionSeconds * 1_000,
    ).toISOString();
    try {
      await this.bucket.put(screenshotKey(id), input.bytes, {
        httpMetadata: { contentType: input.contentType },
        customMetadata: {
          expiresAt,
          capturedAt: input.capturedAt,
          readiness: input.readiness,
        },
      });
    } catch {
      throw new ArtifactStorageError("The screenshot could not be stored.", "write_failed");
    }
    return {
      id,
      type: "screenshot",
      label: "Rendered page screenshot",
      storage: "r2",
      contentType: input.contentType,
      sizeBytes: input.bytes.byteLength,
      createdAt: input.capturedAt,
      expiresAt,
      access: "worker-mediated",
      description: `Captured during browser investigation (${input.readiness}).`,
      url: `/api/v1/artifacts/screenshots/${id}`,
    };
  }
}

export async function retrieveScreenshotArtifact(
  bucket: R2Bucket | undefined,
  id: string,
  now: Date = new Date(),
): Promise<Response> {
  if (!bucket || !ARTIFACT_ID.test(id)) {
    return Response.json(
      { error: { code: "artifact_not_found", message: "Artifact not found.", retryable: false } },
      { status: 404 },
    );
  }
  const object = await bucket.get(screenshotKey(id));
  if (!object || !object.body) {
    return Response.json(
      { error: { code: "artifact_not_found", message: "Artifact not found.", retryable: false } },
      { status: 404 },
    );
  }
  const expiresAt = object.customMetadata?.expiresAt;
  if (!expiresAt || Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now.getTime()) {
    await object.body.cancel();
    return Response.json(
      { error: { code: "artifact_expired", message: "Artifact expired.", retryable: false } },
      { status: 410 },
    );
  }
  const headers = new Headers({
    "content-type": object.httpMetadata?.contentType ?? "image/webp",
    "content-length": String(object.size),
    etag: object.httpEtag,
    "cache-control": "private, max-age=300",
    "content-security-policy": "default-src 'none'; sandbox",
    "x-content-type-options": "nosniff",
    "content-disposition": `inline; filename="packet-journey-${id}.${object.httpMetadata?.contentType === "image/jpeg" ? "jpg" : object.httpMetadata?.contentType === "image/png" ? "png" : "webp"}"`,
  });
  return new Response(object.body, { status: 200, headers });
}
