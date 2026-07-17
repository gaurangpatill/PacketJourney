import type { ArtifactReference } from "../../features/investigation/schema";
import type { SavedArtifact } from "../../features/persistence/schema";
import { logEvent } from "../logging";
import { PersistenceError } from "./errors";
import { PERSISTENCE_LIMITS } from "./limits";
import type { ArtifactRow } from "./types";

const ARTIFACT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTENT_TYPES = new Set(["image/webp", "image/jpeg", "image/png"]);

const sourceKey = (id: string) => `browser-screenshots/${id}.image`;
const savedKey = (investigationId: string, artifactId: string) =>
  `saved-artifacts/${investigationId}/${artifactId}.image`;

export async function promoteScreenshot(input: {
  bucket?: R2Bucket;
  investigationId: string;
  artifact: ArtifactReference | undefined;
  now: Date;
}): Promise<{ row?: ArtifactRow; warning?: string }> {
  if (!input.artifact || input.artifact.type !== "screenshot") return {};
  if (!input.bucket || !ARTIFACT_ID.test(input.artifact.id)) {
    return {
      warning: "The screenshot could not be preserved because artifact storage was unavailable.",
    };
  }
  try {
    const source = await input.bucket.get(sourceKey(input.artifact.id));
    const contentType = source?.httpMetadata?.contentType;
    if (
      !source?.body ||
      !contentType ||
      !CONTENT_TYPES.has(contentType) ||
      (source.customMetadata?.expiresAt &&
        Date.parse(source.customMetadata.expiresAt) <= input.now.getTime())
    ) {
      await source?.body?.cancel();
      return {
        warning: "The original screenshot had expired or was unavailable and was not saved.",
      };
    }
    const bytes = await source.arrayBuffer();
    const expiresAt = new Date(
      input.now.getTime() + PERSISTENCE_LIMITS.savedArtifactRetentionMs,
    ).toISOString();
    const key = savedKey(input.investigationId, input.artifact.id);
    await input.bucket.put(key, bytes, {
      httpMetadata: { contentType },
      customMetadata: {
        expiresAt,
        savedInvestigationId: input.investigationId,
        artifactId: input.artifact.id,
      },
    });
    return {
      row: {
        investigation_id: input.investigationId,
        artifact_id: input.artifact.id,
        r2_key: key,
        artifact_type: "screenshot",
        content_type: contentType as SavedArtifact["contentType"],
        size_bytes: bytes.byteLength,
        created_at: input.artifact.createdAt ?? input.now.toISOString(),
        expires_at: expiresAt,
      },
    };
  } catch {
    return { warning: "The investigation was saved, but its screenshot could not be promoted." };
  }
}

export async function rollbackPromotions(bucket: R2Bucket | undefined, rows: ArtifactRow[]) {
  if (!bucket || !rows.length) return;
  try {
    await bucket.delete(rows.map((row) => row.r2_key));
  } catch {
    logEvent("error", "saved_artifact.rollback_failed", { artifactCount: rows.length });
  }
}

export function savedArtifact(row: ArtifactRow, path: string): SavedArtifact {
  return {
    id: row.artifact_id,
    type: "screenshot",
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    url: path,
  };
}

export async function retrieveSavedArtifact(
  bucket: R2Bucket | undefined,
  row: ArtifactRow | undefined,
  now = new Date(),
): Promise<Response> {
  if (!bucket || !row || Date.parse(row.expires_at) <= now.getTime()) {
    throw new PersistenceError(404, "share_unavailable", "Artifact not found.");
  }
  const object = await bucket.get(row.r2_key);
  if (!object?.body) {
    throw new PersistenceError(404, "share_unavailable", "Artifact not found.");
  }
  const headers = new Headers({
    "content-type": row.content_type,
    "content-length": String(object.size),
    etag: object.httpEtag,
    "cache-control": "private, max-age=300",
    "content-security-policy": "default-src 'none'; sandbox",
    "x-content-type-options": "nosniff",
    "content-disposition": `inline; filename="packet-journey-saved-${row.artifact_id}"`,
  });
  return new Response(object.body, { status: 200, headers });
}
