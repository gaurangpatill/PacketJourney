# Persistence lifecycle

Layer 8 persists explicit user-selected snapshots; it does not automatically archive every live run or AI question.

```text
validated completed/meaningfully-partial Investigation
→ bounded snapshot serializer (schema version 1)
→ deterministic SHA-256 consistency hash
→ selected screenshot promotion to private R2 saved-artifacts/
→ prepared D1 batch for investigation + selected diagnosis/counterfactual + artifact metadata
→ anonymous-owner history or dedicated read-only share projection
```

When the selected diagnosis used authoritative retrieval, the same D1 batch also records a retrieval-run row and zero to four frozen citation rows. The stored diagnosis JSON contains validated frozen display data, while normalized tables preserve query/filter/rank/score/version provenance. Opening or sharing the saved snapshot never queries Vectorize.

## Ownership

The Worker issues a 256-bit random `pj_installation` cookie with `HttpOnly`, `SameSite=Lax`, `Path=/`, one-year lifetime, and `Secure` outside local HTTP development. Only its SHA-256 hash is used as `owner_id`; the raw cookie is never accepted from JSON or stored in D1. This separates browser installations, not people. Clearing cookies loses access, another device cannot recover it, and anyone controlling the browser profile controls its saved records. It is not authentication.

## Save and duplicate behavior

Only canonical `completed` or `failed` investigations with meaningful stage evidence can be saved. A save validates and bounds the snapshot, removes temporary artifact URLs, computes schema-versioned deterministic JSON and a SHA-256 consistency hash, and records selected AI/counterfactual data only when explicitly submitted. Exact duplicate hashes create separate entries and return a duplicate warning; intent is never silently merged.

Persistence errors do not alter the in-memory investigation. A snapshot is historical and never refreshed automatically.

## Limits

- Investigation snapshot: 900 KiB serialized JSON.
- Shared report: 1 MiB serialized response.
- Title: 120 characters.
- Saved investigations: 100 per anonymous installation.
- Selected diagnoses/counterfactuals: one each per save in Layer 8.
- Shares: 10 per investigation; maximum lifetime 30 days.
- List page: 20 by default, 50 maximum.
- Saved screenshot: existing 1.5 MiB capture limit; 30-day saved retention metadata.

These application bounds stay below D1's current 2 MB string/row limit. D1 migration, snapshot schema, counterfactual engine, AI prompt/model, embedding model, Vectorize index, corpus, and retrieval algorithm versions are independent compatibility axes.

## Deletion

Owner deletion first loads exclusively associated saved-artifact keys, deletes the D1 investigation (foreign keys cascade), and then deletes those R2 objects. R2 cleanup failures are safely logged and recorded in a non-owner cleanup table without exposing keys to clients; a later maintenance process can retry. No Queue is introduced in Layer 8.
