# D1 schema

Database migration `0001_persistence.sql` creates:

- `investigations`: owner-scoped indexed metadata, schema version, bounded canonical JSON, consistency hash, source/finding/artifact flags, and timestamps.
- `ai_diagnoses`: one explicitly selected validated diagnosis per saved investigation.
- `counterfactual_results`: one explicitly selected validated simulation per saved investigation, tied to the snapshot hash and engine version.
- `share_links`: hashed bearer secret, inclusion policy, expiration/revocation/access metadata.
- `investigation_artifacts`: private saved R2 association and retention metadata.
- `artifact_cleanup_failures`: bounded operational repair records when post-delete R2 cleanup fails.

Foreign keys are enabled and child rows cascade on investigation deletion. Owner/update, owner/hostname, owner/hash, share-token, and artifact indexes support bounded routes. Every runtime query is a static prepared statement using ordered `?NNN` bindings. No user input becomes SQL syntax.

Wrangler records applied SQL migrations separately in `d1_migrations`. Snapshot schema version `1` identifies the JSON contract; it is not a D1 migration number. Future unsupported snapshot versions fail instead of being reinterpreted.

Official references used for the design: [D1 Worker binding API](https://developers.cloudflare.com/d1/worker-api/), [prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/), [migrations](https://developers.cloudflare.com/d1/reference/migrations/), and [limits](https://developers.cloudflare.com/d1/platform/limits/).
