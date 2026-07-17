import { z } from "zod";
import { REFERENCE_CONFIG } from "./config";

export const referencePublisherSchema = z.enum([
  "cloudflare",
  "ietf",
  "mdn",
  "owasp",
  "web-dev",
  "cab-forum",
]);

export const referenceCategorySchema = z.enum([
  "dns",
  "dnssec",
  "tls",
  "certificates",
  "http",
  "redirects",
  "caching",
  "cdn",
  "security-headers",
  "browser-navigation",
  "resource-loading",
  "performance",
  "core-web-vitals",
  "third-party-resources",
  "cloudflare-workers-runtime",
  "cloudflare-browser-run",
  "cloudflare-r2",
  "cloudflare-d1",
  "cloudflare-vectorize",
]);

const safeText = (maximum: number) => z.string().trim().min(1).max(maximum);
const hash = z.string().regex(/^[0-9a-f]{64}$/);

export const referenceManifestEntrySchema = z
  .object({
    sourceId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
    canonicalUrl: z.string().url().max(1_024),
    publisher: referencePublisherSchema,
    documentTitle: safeText(240),
    category: referenceCategorySchema,
    topics: z
      .array(z.string().regex(/^[a-z0-9][a-z0-9-]{1,49}$/))
      .max(REFERENCE_CONFIG.maximumTopics),
    language: z.literal("en"),
    expectedContentType: z.enum(["html", "markdown", "text", "rfc"]),
    sourceVersion: safeText(80).optional(),
    enabled: z.boolean(),
  })
  .strict();

export const referenceChunkSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_-]{16,64}$/),
    sourceId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
    documentTitle: safeText(240),
    canonicalUrl: z.string().url().max(1_024),
    publisher: referencePublisherSchema,
    category: referenceCategorySchema,
    topics: z.array(z.string().min(2).max(50)).max(REFERENCE_CONFIG.maximumTopics),
    sectionPath: z.array(safeText(160)).max(8),
    heading: safeText(200),
    content: safeText(REFERENCE_CONFIG.maximumChunkCharacters),
    contentHash: hash,
    chunkIndex: z.number().int().nonnegative().max(999),
    sourceVersion: safeText(80).optional(),
    sourcePublishedAt: z.string().datetime().optional(),
    sourceRetrievedAt: z.string().datetime(),
    corpusVersion: z.literal(REFERENCE_CONFIG.corpusVersion),
    embeddingModel: z.literal(REFERENCE_CONFIG.embeddingModel),
    language: z.literal("en"),
  })
  .strict();

export const referenceFilterSchema = z
  .object({
    categories: z.array(referenceCategorySchema).min(1).max(6),
    publishers: z.array(referencePublisherSchema).max(6).optional(),
    corpusVersion: z.literal(REFERENCE_CONFIG.corpusVersion),
    language: z.literal("en"),
  })
  .strict();

export const referenceCitationSchema = z
  .object({
    citationId: z.string().regex(/^citation-[a-z0-9_-]{8,64}$/),
    referenceChunkId: referenceChunkSchema.shape.id,
    sourceId: referenceManifestEntrySchema.shape.sourceId,
    publisher: referencePublisherSchema,
    category: referenceCategorySchema,
    title: safeText(240),
    canonicalUrl: z.string().url().max(1_024),
    heading: safeText(200),
    excerpt: safeText(REFERENCE_CONFIG.maximumExcerptCharacters),
    selectionReason: safeText(500),
    contentHash: hash,
    sourceVersion: safeText(80).optional(),
    sourceRetrievedAt: z.string().datetime(),
    corpusVersion: z.literal(REFERENCE_CONFIG.corpusVersion),
    similarityScore: z.number().min(-1).max(1),
    rerankScore: z.number().min(0).max(1),
    rank: z.number().int().min(1).max(REFERENCE_CONFIG.maximumSelected),
  })
  .strict();

export const referenceRetrievalStatusSchema = z.enum([
  "success",
  "no-result",
  "unavailable",
  "fixture",
]);

export const referenceRetrievalMetadataSchema = z
  .object({
    retrievalRunId: z.string().uuid(),
    status: referenceRetrievalStatusSchema,
    retrievalVersion: z.literal(REFERENCE_CONFIG.retrievalVersion),
    indexVersion: z.literal(REFERENCE_CONFIG.indexVersion),
    corpusVersion: z.literal(REFERENCE_CONFIG.corpusVersion),
    embeddingModel: z.literal(REFERENCE_CONFIG.embeddingModel),
    dimensions: z.literal(REFERENCE_CONFIG.dimensions),
    controlledQuery: safeText(1_200).optional(),
    questionHash: hash.optional(),
    filter: referenceFilterSchema,
    candidateCount: z.number().int().nonnegative().max(REFERENCE_CONFIG.topK),
    selectedCount: z.number().int().nonnegative().max(REFERENCE_CONFIG.maximumSelected),
    retrievedAt: z.string().datetime(),
    fixture: z.boolean(),
    errorCode: z
      .enum(["binding-unavailable", "embedding-failed", "query-failed", "d1-failed"])
      .optional(),
  })
  .strict();

export const referenceRetrievalResultSchema = z
  .object({
    metadata: referenceRetrievalMetadataSchema,
    citations: z.array(referenceCitationSchema).max(REFERENCE_CONFIG.maximumSelected),
  })
  .strict();

export type ReferencePublisher = z.infer<typeof referencePublisherSchema>;
export type ReferenceCategory = z.infer<typeof referenceCategorySchema>;
export type ReferenceManifestEntry = z.infer<typeof referenceManifestEntrySchema>;
export type ReferenceChunk = z.infer<typeof referenceChunkSchema>;
export type ReferenceFilter = z.infer<typeof referenceFilterSchema>;
export type ReferenceCitation = z.infer<typeof referenceCitationSchema>;
export type ReferenceRetrievalMetadata = z.infer<typeof referenceRetrievalMetadataSchema>;
export type ReferenceRetrievalResult = z.infer<typeof referenceRetrievalResultSchema>;
