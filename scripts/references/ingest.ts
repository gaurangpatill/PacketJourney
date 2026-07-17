import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { REFERENCE_CONFIG } from "../../src/features/references/config";
import type { ReferenceChunk } from "../../src/features/references/schema";
import { buildReferenceChunks, sha256Hex } from "../../src/references/chunking";
import { validateReferenceManifest } from "../../src/references/manifest";
import { extractReferenceSections } from "./extract";

const outputDirectory = ".reference-build";
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const generateEmbeddings = process.argv.includes("--embed");

function sql(value: string | number | boolean | null | undefined): string {
  if (value === undefined || value === null) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function fetchSource(url: string): Promise<{ text: string; contentType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "PacketJourney-ReferenceIngest/1.0" },
      redirect: "error",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > REFERENCE_CONFIG.maximumSourceBytes) throw new Error("source too large");
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > REFERENCE_CONFIG.maximumSourceBytes)
      throw new Error("source too large");
    return {
      text: new TextDecoder().decode(buffer),
      contentType: response.headers.get("content-type") ?? "",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function embed(contents: string[]): Promise<number[][]> {
  if (!generateEmbeddings) return [];
  if (!accountId || !apiToken)
    throw new Error("--embed requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${REFERENCE_CONFIG.embeddingModel}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
      body: JSON.stringify({ text: contents }),
    },
  );
  const payload = (await response.json()) as {
    success?: boolean;
    result?: { data?: number[][] };
    errors?: unknown;
  };
  if (!response.ok || !payload.success || !payload.result?.data)
    throw new Error("Workers AI embedding request failed");
  for (const vector of payload.result.data)
    if (vector.length !== REFERENCE_CONFIG.dimensions)
      throw new Error("embedding dimension mismatch");
  return payload.result.data;
}

async function previousHashes(): Promise<Set<string>> {
  try {
    const data = JSON.parse(await readFile(join(outputDirectory, "report.json"), "utf8")) as {
      chunkHashes?: string[];
    };
    return new Set(data.chunkHashes ?? []);
  } catch {
    return new Set();
  }
}

async function main() {
  const sources = validateReferenceManifest().filter((source) => source.enabled);
  const previous = await previousHashes();
  const chunks: ReferenceChunk[] = [];
  const failures: Array<{ sourceId: string; reason: string }> = [];
  const sourceRows: Array<{ source: (typeof sources)[number]; retrievedAt: string; hash: string }> =
    [];
  for (const source of sources) {
    try {
      const response = await fetchSource(source.canonicalUrl);
      const expected =
        source.expectedContentType === "rfc" ? /text|octet-stream/ : /html|text|markdown/;
      if (!expected.test(response.contentType))
        throw new Error(`unexpected content type ${response.contentType}`);
      const retrievedAt = new Date().toISOString();
      const hash = await sha256Hex(response.text);
      const sections = extractReferenceSections(source, response.text);
      const sourceChunks = await buildReferenceChunks({ source, sections, retrievedAt });
      if (!sourceChunks.length) throw new Error("no reference content extracted");
      chunks.push(...sourceChunks);
      sourceRows.push({ source, retrievedAt, hash });
    } catch (error) {
      failures.push({
        sourceId: source.sourceId,
        reason: error instanceof Error ? error.message : "unknown failure",
      });
    }
  }
  const vectors: Array<{
    id: string;
    values: number[];
    namespace: string;
    metadata: Record<string, string>;
  }> = [];
  if (generateEmbeddings) {
    for (let index = 0; index < chunks.length; index += REFERENCE_CONFIG.embeddingBatchSize) {
      const batch = chunks.slice(index, index + REFERENCE_CONFIG.embeddingBatchSize);
      const embeddings = await embed(
        batch.map((chunk) => `${chunk.documentTitle}\n${chunk.heading}\n${chunk.content}`),
      );
      batch.forEach((chunk, offset) =>
        vectors.push({
          id: chunk.id,
          values: embeddings[offset],
          namespace: REFERENCE_CONFIG.namespace,
          metadata: {
            publisher: chunk.publisher,
            category: chunk.category,
            corpusVersion: chunk.corpusVersion,
            language: chunk.language,
            sourceId: chunk.sourceId,
            contentHash: chunk.contentHash,
          },
        }),
      );
    }
  }
  const now = new Date().toISOString();
  const statements = ["PRAGMA foreign_keys = ON;", "BEGIN TRANSACTION;"];
  for (const row of sourceRows)
    statements.push(
      `INSERT INTO reference_sources (id,publisher,title,canonical_url,category,topics_json,source_version,published_at,retrieved_at,content_hash,corpus_version,enabled,created_at,updated_at) VALUES (${sql(row.source.sourceId)},${sql(row.source.publisher)},${sql(row.source.documentTitle)},${sql(row.source.canonicalUrl)},${sql(row.source.category)},${sql(JSON.stringify(row.source.topics))},${sql(row.source.sourceVersion)},NULL,${sql(row.retrievedAt)},${sql(row.hash)},${sql(REFERENCE_CONFIG.corpusVersion)},1,${sql(now)},${sql(now)}) ON CONFLICT(id) DO UPDATE SET title=excluded.title,canonical_url=excluded.canonical_url,topics_json=excluded.topics_json,retrieved_at=excluded.retrieved_at,content_hash=excluded.content_hash,corpus_version=excluded.corpus_version,enabled=1,updated_at=excluded.updated_at;`,
    );
  for (const chunk of chunks)
    statements.push(
      `INSERT INTO reference_chunks (id,source_id,heading,section_path_json,topics_json,content,content_hash,chunk_index,embedding_model,corpus_version,created_at,updated_at) VALUES (${sql(chunk.id)},${sql(chunk.sourceId)},${sql(chunk.heading)},${sql(JSON.stringify(chunk.sectionPath))},${sql(JSON.stringify(chunk.topics))},${sql(chunk.content)},${sql(chunk.contentHash)},${chunk.chunkIndex},${sql(chunk.embeddingModel)},${sql(chunk.corpusVersion)},${sql(now)},${sql(now)}) ON CONFLICT(id) DO UPDATE SET content=excluded.content,content_hash=excluded.content_hash,updated_at=excluded.updated_at;`,
    );
  statements.push("COMMIT;");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, "reference-chunks.sql"), statements.join("\n"));
  await writeFile(
    join(outputDirectory, "vectors.ndjson"),
    vectors.map((item) => JSON.stringify(item)).join("\n"),
  );
  const currentHashes = new Set(chunks.map((chunk) => chunk.contentHash));
  const report = {
    generatedAt: now,
    indexName: REFERENCE_CONFIG.indexName,
    indexVersion: REFERENCE_CONFIG.indexVersion,
    corpusVersion: REFERENCE_CONFIG.corpusVersion,
    embeddingModel: REFERENCE_CONFIG.embeddingModel,
    dimensions: REFERENCE_CONFIG.dimensions,
    sourcesFetched: sourceRows.length,
    sourcesFailed: failures.length,
    chunksAddedOrChanged: chunks.filter((chunk) => !previous.has(chunk.contentHash)).length,
    chunksReused: chunks.filter((chunk) => previous.has(chunk.contentHash)).length,
    chunksRemoved: [...previous].filter((hash) => !currentHashes.has(hash)).length,
    embeddingsGenerated: vectors.length,
    failures,
    chunkHashes: [...currentHashes].sort(),
  };
  await writeFile(join(outputDirectory, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(
    `${JSON.stringify({ ...report, chunkHashes: `${report.chunkHashes.length} hashes recorded in .reference-build/report.json` }, null, 2)}\n`,
  );
  if (failures.length) throw new Error(`${failures.length} allowlisted reference source(s) failed.`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Reference ingestion failed."}\n`);
  process.exitCode = 1;
});
