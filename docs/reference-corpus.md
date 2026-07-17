# Reference corpus

Layer 9 starts with 17 reviewed English sources from six publishers: Cloudflare Developers, the IETF RFC Editor, MDN Web Docs, OWASP, web.dev, and the CA/Browser Forum. `src/references/manifest.ts` is the only ingestion allowlist. It records the stable source ID, canonical HTTPS URL, publisher, title, category, topics, content type, language, version where known, and enablement flag.

The initial corpus covers HTTP/cache and redirect semantics, DNS/CNAME and DNSSEC, certificates, Cloudflare cache behavior and Worker observability, browser resource timing, security headers, rendering and third-party performance, Browser Run, D1, private R2 access, and Vectorize metadata filters. It deliberately excludes blogs, search results, user pages, investigation data, screenshots, logs, generated explanations, and uploads.

`2026-07-v1` is a corpus compatibility identifier, not a claim that every source was published in July 2026. Source versions such as `RFC 9111`, retrieval timestamps, source hashes, and chunk hashes remain separate. Disabled entries cannot be ingested or retrieved. Adding a URL requires code review and manifest validation; the model and user cannot add sources.

The fixture corpus contains short reviewed passages for credential-free local retrieval and 15 evaluation cases. It is always labeled `LOCAL FIXTURE`, is never enabled by a production fallback, and is not the production Vectorize corpus.
