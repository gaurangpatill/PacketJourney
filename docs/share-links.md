# Share links

Creation generates 32 random bytes using Web Crypto and returns the base64url token once. D1 stores only `SHA-256(token)` and a separate non-secret row ID. Tokens contain no owner or database identifier. Application logs record only the share row ID and outcome, never request paths containing tokens or token values.

A share records explicit inclusion flags for the selected diagnosis, selected counterfactual, and saved screenshot. Lifetime is optional but cannot exceed 30 days. Revocation sets `revoked_at` and expiration is checked on every resolution. A well-formed known token can produce a dedicated expired or revoked state so the read-only UI can explain why access ended; malformed/unknown tokens remain neutral. Public resolution is rate-limited and updates only bounded access count/last-access metadata.

The public endpoint builds a dedicated projection with `SAVED SNAPSHOT`, `READ ONLY`, capture time, sanitized requested/final URLs, canonical stages/evidence/findings, selected children allowed by policy, runtime limitations, and controlled screenshot URLs. It excludes owner hashes, D1/share IDs, token hashes, raw R2 keys, prompts, Gateway metadata, logs, and configuration.

Shared screenshots remain in the private bucket. The Worker validates the active share hash, expiration/revocation, screenshot permission, artifact association/type/expiry, then streams the object. Bucket keys never enter the URL or response.

When AI inclusion is enabled, the selected diagnosis carries its frozen validated reference cards and version metadata. The report labels them `Reference snapshot` and reads only D1 data; it does not query Vectorize or assume current source freshness. It may expose publisher, title, section, bounded excerpt, canonical allowlisted URL, retrieval date, source version, and corpus version. Projection deletes the controlled retrieval query and question hash; it also excludes internal run/row identifiers, embeddings, full documents, prompts, and hidden scoring details.
