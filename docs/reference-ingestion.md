# Controlled reference ingestion

`npm run references:ingest` reads only the checked-in enabled manifest. For each source it applies a 15-second timeout, rejects redirects, validates content type, caps the response at 1.5 MB, removes executable/navigation/footer boilerplate, preserves semantic headings, normalizes text, splits sections into chunks no larger than 1,800 characters, and caps each source at 80 chunks.

Source and chunk SHA-256 hashes drive change reporting. Vector IDs are deterministic hashes of publisher, source ID, section path, chunk index, content hash, and corpus version and remain below Vectorize's 64-byte ID limit. `--embed` batches at most 32 chunks through `@cf/qwen/qwen3-embedding-0.6b`, rejects vectors that are not exactly 1,024 dimensions, and writes bounded Vectorize NDJSON. Without `--embed`, the command performs extraction/chunk/report preparation only.

Generated SQL, NDJSON, and the machine-readable report live under ignored `.reference-build/`; source downloads, API tokens, and embeddings are not committed. The SQL upserts normalized D1 sources/chunks. The report identifies fetched/failed sources, changed/reused/removed chunks, and embeddings generated. `npm run references:verify` rejects a report whose source count, index, corpus, or dimensions do not match the checked-in contract.

Production operator sequence:

1. Create `packet-journey-references-v1` with 1,024 dimensions and cosine metric.
2. Before upsert, create string metadata indexes for `publisher`, `category`, `corpusVersion`, and `language`.
3. Run ingestion with account ID and a scoped temporary API token in the process environment.
4. Apply generated SQL to the target D1 database, upsert generated NDJSON into the index, and run verification/query smokes.
5. Keep the prior versioned index during rollout. Switch only the Wrangler binding after validation; rollback restores the previous binding. Delete old indexes only after no live deployment references them. A model/dimension/metric change requires a new index and re-embedding.

Wrangler setup for this version:

```bash
npx wrangler vectorize create packet-journey-references-v1 --dimensions=1024 --metric=cosine
npx wrangler vectorize create-metadata-index packet-journey-references-v1 --propertyName=publisher --type=string
npx wrangler vectorize create-metadata-index packet-journey-references-v1 --propertyName=category --type=string
npx wrangler vectorize create-metadata-index packet-journey-references-v1 --propertyName=corpusVersion --type=string
npx wrangler vectorize create-metadata-index packet-journey-references-v1 --propertyName=language --type=string
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... npm run references:ingest -- --embed
npx wrangler d1 execute packet-journey --remote --file=.reference-build/reference-chunks.sql
npx wrangler vectorize upsert packet-journey-references-v1 --file=.reference-build/vectors.ndjson
npm run references:verify
```

Use a scoped token only for the operator command and do not put it in `.dev.vars`; the running Worker uses bindings. Preview should use its own D1 data and preferably a separately named preview index when independent corpus rollout is required.

The current extractor intentionally favors stable main/article and RFC sections over publisher-specific crawling. A source-layout change fails or appears as a hash/chunk change for review; it does not expand crawl scope.
