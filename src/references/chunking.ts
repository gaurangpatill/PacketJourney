import { REFERENCE_CONFIG } from "../features/references/config";
import {
  referenceChunkSchema,
  type ReferenceChunk,
  type ReferenceManifestEntry,
} from "../features/references/schema";

export interface ReferenceSection {
  heading: string;
  sectionPath: string[];
  content: string;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeReferenceText(value: string): string {
  return value
    .normalize("NFKC")
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127
        ? " "
        : character;
    })
    .join("")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitSection(content: string): string[] {
  if (content.length <= REFERENCE_CONFIG.maximumChunkCharacters) return [content];
  const paragraphs = content.split(/\n\n+/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const pieces =
      paragraph.length > REFERENCE_CONFIG.maximumChunkCharacters
        ? (paragraph.match(
            new RegExp(`.{1,${REFERENCE_CONFIG.targetChunkCharacters}}(?:\\s|$)`, "gs"),
          ) ?? [paragraph])
        : [paragraph];
    for (const piece of pieces) {
      const candidate = current ? `${current}\n\n${piece.trim()}` : piece.trim();
      if (candidate.length > REFERENCE_CONFIG.maximumChunkCharacters && current) {
        chunks.push(current);
        current = piece.trim();
      } else {
        current = candidate;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function buildReferenceChunks(input: {
  source: ReferenceManifestEntry;
  sections: ReferenceSection[];
  retrievedAt: string;
  publishedAt?: string;
}): Promise<ReferenceChunk[]> {
  const chunks: ReferenceChunk[] = [];
  for (const section of input.sections) {
    const normalized = normalizeReferenceText(section.content);
    if (!normalized) continue;
    for (const content of splitSection(normalized)) {
      if (chunks.length >= REFERENCE_CONFIG.maximumChunksPerSource) break;
      const chunkIndex = chunks.length;
      const contentHash = await sha256Hex(content);
      const identity = [
        input.source.publisher,
        input.source.sourceId,
        section.sectionPath.join("/"),
        chunkIndex,
        contentHash,
        REFERENCE_CONFIG.corpusVersion,
      ].join("|");
      const id = `ref_${(await sha256Hex(identity)).slice(0, 40)}`;
      chunks.push(
        referenceChunkSchema.parse({
          id,
          sourceId: input.source.sourceId,
          documentTitle: input.source.documentTitle,
          canonicalUrl: input.source.canonicalUrl,
          publisher: input.source.publisher,
          category: input.source.category,
          topics: input.source.topics,
          sectionPath: section.sectionPath.slice(0, 8),
          heading: normalizeReferenceText(section.heading).slice(0, 200) || "Overview",
          content,
          contentHash,
          chunkIndex,
          ...(input.source.sourceVersion ? { sourceVersion: input.source.sourceVersion } : {}),
          ...(input.publishedAt ? { sourcePublishedAt: input.publishedAt } : {}),
          sourceRetrievedAt: input.retrievedAt,
          corpusVersion: REFERENCE_CONFIG.corpusVersion,
          embeddingModel: REFERENCE_CONFIG.embeddingModel,
          language: "en",
        }),
      );
    }
  }
  return chunks;
}
