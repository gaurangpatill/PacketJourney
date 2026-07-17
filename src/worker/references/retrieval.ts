import { REFERENCE_CONFIG } from "../../features/references/config";
import {
  referenceChunkSchema,
  referenceRetrievalResultSchema,
  type ReferenceCategory,
  type ReferenceChunk,
  type ReferenceCitation,
  type ReferenceRetrievalResult,
} from "../../features/references/schema";
import type { AiExpertiseMode } from "../../features/investigation/aiSchema";
import type { Investigation } from "../../features/investigation/schema";
import { fixtureReferenceCorpus } from "../../references/fixtureCorpus";
import { referenceManifestById } from "../../references/manifest";
import { sha256Hex } from "../../references/chunking";
import type { WorkersAiBindingLike } from "../ai/client";
import { buildControlledReferenceQuery } from "./queryBuilder";
import { z } from "zod";

export interface ReferenceRetriever {
  retrieve(input: {
    question: string;
    investigation: Investigation;
    expertiseMode: AiExpertiseMode;
  }): Promise<ReferenceRetrievalResult>;
}

type VectorMatch = { id: string; score: number; metadata?: Record<string, unknown> };
type VectorIndexLike = {
  query(vector: number[], options: Record<string, unknown>): Promise<{ matches: VectorMatch[] }>;
};

const embeddingResponseSchema = z.object({ data: z.array(z.array(z.number())) });

function parseStoredJson(value: unknown): unknown {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

const authority: Record<ReferenceCategory, string[]> = {
  dns: ["ietf", "cloudflare"],
  dnssec: ["ietf", "cloudflare"],
  tls: ["ietf", "cab-forum"],
  certificates: ["ietf", "cab-forum"],
  http: ["ietf", "mdn"],
  redirects: ["ietf", "mdn"],
  caching: ["ietf", "cloudflare", "mdn"],
  cdn: ["cloudflare", "ietf"],
  "security-headers": ["owasp", "mdn"],
  "browser-navigation": ["mdn", "web-dev"],
  "resource-loading": ["mdn", "web-dev"],
  performance: ["web-dev", "mdn"],
  "core-web-vitals": ["web-dev"],
  "third-party-resources": ["web-dev", "mdn"],
  "cloudflare-workers-runtime": ["cloudflare"],
  "cloudflare-browser-run": ["cloudflare"],
  "cloudflare-r2": ["cloudflare"],
  "cloudflare-d1": ["cloudflare"],
  "cloudflare-vectorize": ["cloudflare"],
};

async function baseResult(input: {
  query: ReturnType<typeof buildControlledReferenceQuery>;
  status: ReferenceRetrievalResult["metadata"]["status"];
  candidateCount: number;
  citations?: ReferenceCitation[];
  fixture: boolean;
  errorCode?: ReferenceRetrievalResult["metadata"]["errorCode"];
}): Promise<ReferenceRetrievalResult> {
  const citations = input.citations ?? [];
  return referenceRetrievalResultSchema.parse({
    metadata: {
      retrievalRunId: crypto.randomUUID(),
      status: input.status,
      retrievalVersion: REFERENCE_CONFIG.retrievalVersion,
      indexVersion: REFERENCE_CONFIG.indexVersion,
      corpusVersion: REFERENCE_CONFIG.corpusVersion,
      embeddingModel: REFERENCE_CONFIG.embeddingModel,
      dimensions: REFERENCE_CONFIG.dimensions,
      controlledQuery: input.query.query,
      questionHash: await sha256Hex(input.query.sanitizedQuestion),
      filter: input.query.filter,
      candidateCount: Math.min(input.candidateCount, REFERENCE_CONFIG.topK),
      selectedCount: citations.length,
      retrievedAt: new Date().toISOString(),
      fixture: input.fixture,
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    },
    citations,
  });
}

function tokenOverlap(terms: string[], chunk: ReferenceChunk): number {
  const haystack = `${chunk.heading} ${chunk.content} ${chunk.topics.join(" ")}`.toLowerCase();
  const relevant = terms.filter((term) => haystack.includes(term)).length;
  return terms.length ? relevant / Math.min(terms.length, 10) : 0;
}

function selectCitations(input: {
  matches: Array<{ chunk: ReferenceChunk; similarity: number }>;
  categories: ReferenceCategory[];
  terms: string[];
}): ReferenceCitation[] {
  const seenHashes = new Set<string>();
  const perSource = new Map<string, number>();
  const selected: ReferenceCitation[] = [];
  let characters = 0;
  const ranked = input.matches
    .filter(({ chunk, similarity }) => {
      const source = referenceManifestById.get(chunk.sourceId);
      return Boolean(
        source?.enabled &&
        source.canonicalUrl === chunk.canonicalUrl &&
        source.category === chunk.category &&
        chunk.corpusVersion === REFERENCE_CONFIG.corpusVersion &&
        similarity >= REFERENCE_CONFIG.minimumSimilarity,
      );
    })
    .map(({ chunk, similarity }) => {
      const categoryScore = input.categories.includes(chunk.category) ? 1 : 0;
      const overlap = Math.min(1, tokenOverlap(input.terms, chunk));
      const preferred = authority[chunk.category].includes(chunk.publisher) ? 1 : 0;
      return {
        chunk,
        similarity,
        score: Math.min(
          1,
          similarity * 0.7 + categoryScore * 0.1 + overlap * 0.1 + preferred * 0.07 + 0.03,
        ),
      };
    })
    .sort((left, right) => right.score - left.score || left.chunk.id.localeCompare(right.chunk.id));
  for (const item of ranked) {
    if (selected.length >= REFERENCE_CONFIG.maximumSelected) break;
    if (seenHashes.has(item.chunk.contentHash)) continue;
    if ((perSource.get(item.chunk.sourceId) ?? 0) >= REFERENCE_CONFIG.maximumPerSource) continue;
    const excerpt = item.chunk.content.slice(0, REFERENCE_CONFIG.maximumExcerptCharacters).trim();
    if (!excerpt || characters + excerpt.length > REFERENCE_CONFIG.maximumContextCharacters)
      continue;
    seenHashes.add(item.chunk.contentHash);
    perSource.set(item.chunk.sourceId, (perSource.get(item.chunk.sourceId) ?? 0) + 1);
    characters += excerpt.length;
    selected.push({
      citationId: `citation-${item.chunk.id.slice(4)}`,
      referenceChunkId: item.chunk.id,
      sourceId: item.chunk.sourceId,
      publisher: item.chunk.publisher,
      category: item.chunk.category,
      title: item.chunk.documentTitle,
      canonicalUrl: item.chunk.canonicalUrl,
      heading: item.chunk.heading,
      excerpt,
      selectionReason: `Matched ${item.chunk.category} semantics from an allowlisted ${item.chunk.publisher} source.`,
      contentHash: item.chunk.contentHash,
      ...(item.chunk.sourceVersion ? { sourceVersion: item.chunk.sourceVersion } : {}),
      sourceRetrievedAt: item.chunk.sourceRetrievedAt,
      corpusVersion: item.chunk.corpusVersion,
      similarityScore: item.similarity,
      rerankScore: item.score,
      rank: selected.length + 1,
    });
  }
  return selected;
}

function queryFor(input: Parameters<ReferenceRetriever["retrieve"]>[0]) {
  return buildControlledReferenceQuery(input);
}

export class FixtureReferenceRetriever implements ReferenceRetriever {
  async retrieve(input: Parameters<ReferenceRetriever["retrieve"]>[0]) {
    const query = queryFor(input);
    const corpus = await fixtureReferenceCorpus();
    const candidates = corpus
      .filter((chunk) => query.filter.categories.includes(chunk.category))
      .filter(
        (chunk) => !query.filter.publishers || query.filter.publishers.includes(chunk.publisher),
      )
      .map((chunk) => ({
        chunk,
        similarity: Math.min(0.94, 0.58 + tokenOverlap(query.terms, chunk) * 0.36),
      }))
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, REFERENCE_CONFIG.topK);
    const citations = selectCitations({
      matches: candidates,
      categories: query.filter.categories,
      terms: query.terms,
    });
    return baseResult({
      query,
      status: citations.length ? "fixture" : "no-result",
      candidateCount: candidates.length,
      citations,
      fixture: true,
    });
  }
}

export class UnavailableReferenceRetriever implements ReferenceRetriever {
  async retrieve(input: Parameters<ReferenceRetriever["retrieve"]>[0]) {
    return baseResult({
      query: queryFor(input),
      status: "unavailable",
      candidateCount: 0,
      fixture: false,
      errorCode: "binding-unavailable",
    });
  }
}

export class VectorizeReferenceRetriever implements ReferenceRetriever {
  constructor(
    private readonly ai: WorkersAiBindingLike,
    private readonly index: VectorIndexLike,
    private readonly database: D1Database,
  ) {}

  async retrieve(input: Parameters<ReferenceRetriever["retrieve"]>[0]) {
    const query = queryFor(input);
    let vector: number[];
    try {
      const response = embeddingResponseSchema.parse(
        await this.ai.run(REFERENCE_CONFIG.embeddingModel, { text: [query.query] }),
      );
      const data = response.data[0];
      if (
        !Array.isArray(data) ||
        data.length !== REFERENCE_CONFIG.dimensions ||
        data.some((value) => typeof value !== "number")
      )
        throw new Error("dimension mismatch");
      vector = data;
    } catch {
      return baseResult({
        query,
        status: "unavailable",
        candidateCount: 0,
        fixture: false,
        errorCode: "embedding-failed",
      });
    }
    let matches: VectorMatch[];
    try {
      const filter: Record<string, unknown> = {
        category: { $in: query.filter.categories },
        corpusVersion: REFERENCE_CONFIG.corpusVersion,
        language: "en",
        ...(query.filter.publishers ? { publisher: { $in: query.filter.publishers } } : {}),
      };
      const result = await this.index.query(vector, {
        topK: REFERENCE_CONFIG.topK,
        returnMetadata: "all",
        namespace: REFERENCE_CONFIG.namespace,
        filter,
      });
      matches = result.matches;
    } catch {
      return baseResult({
        query,
        status: "unavailable",
        candidateCount: 0,
        fixture: false,
        errorCode: "query-failed",
      });
    }
    try {
      const resolved = await Promise.all(
        matches.map(async (match) => {
          const result = await this.database
            .prepare(
              `SELECT c.*, s.title AS document_title, s.canonical_url, s.publisher, s.category,
                    s.source_version, s.published_at, s.retrieved_at, s.enabled
             FROM reference_chunks c INNER JOIN reference_sources s ON s.id = c.source_id
             WHERE c.id = ?1`,
            )
            .bind(match.id)
            .first<Record<string, unknown>>();
          if (!result || result.enabled !== 1) return undefined;
          const metadata = match.metadata ?? {};
          const chunk = referenceChunkSchema.safeParse({
            id: result.id,
            sourceId: result.source_id,
            documentTitle: result.document_title,
            canonicalUrl: result.canonical_url,
            publisher: result.publisher,
            category: result.category,
            topics: parseStoredJson(result.topics_json),
            sectionPath: parseStoredJson(result.section_path_json),
            heading: result.heading,
            content: result.content,
            contentHash: result.content_hash,
            chunkIndex: result.chunk_index,
            ...(result.source_version ? { sourceVersion: result.source_version } : {}),
            ...(result.published_at ? { sourcePublishedAt: result.published_at } : {}),
            sourceRetrievedAt: result.retrieved_at,
            corpusVersion: result.corpus_version,
            embeddingModel: result.embedding_model,
            language: "en",
          });
          if (!chunk.success || metadata.contentHash !== chunk.data.contentHash) return undefined;
          return { chunk: chunk.data, similarity: match.score };
        }),
      );
      const candidates = resolved.filter((item): item is NonNullable<typeof item> => Boolean(item));
      const citations = selectCitations({
        matches: candidates,
        categories: query.filter.categories,
        terms: query.terms,
      });
      return baseResult({
        query,
        status: citations.length ? "success" : "no-result",
        candidateCount: matches.length,
        citations,
        fixture: false,
      });
    } catch {
      return baseResult({
        query,
        status: "unavailable",
        candidateCount: matches.length,
        fixture: false,
        errorCode: "d1-failed",
      });
    }
  }
}
