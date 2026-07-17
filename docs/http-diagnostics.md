# Deterministic HTTP diagnostics

Layer 3 exposes `POST /api/v1/investigations/http` from an ES-module Cloudflare Worker. The endpoint accepts `{ "url": string }` and returns either a runtime-validated canonical investigation or a structured public error. It does not use AI.

## Fetch behavior

- Normalize once with the shared Worker normalizer and validate the initial destination before target I/O.
- Preflight hostname A and AAAA answers through `https://cloudflare-dns.com/dns-query` and reject any non-public answer.
- Send a minimal `GET` because public `HEAD` behavior is inconsistent.
- Set only `Accept`, `Accept-Encoding`, and a Packet Journey `User-Agent`; never forward user headers, credentials, cookies, or payloads.
- Set `redirect: "manual"` and `cache: "no-store"`.
- Measure each target subrequest with `performance.now()` until response headers arrive.
- Copy allowlisted headers, then cancel the body stream without reading document content.
- Follow at most eight validated redirects and apply per-hop and overall abort timeouts.

## Header allowlist

Packet Journey retains only:

```text
location
cache-control, age, expires, etag, last-modified, vary, cdn-cache-control
content-type, content-length, content-encoding
server, via
cf-cache-status, cf-ray
x-cache, x-cache-hits, x-amz-cf-id, x-amz-cf-pop, x-served-by, x-azure-ref
strict-transport-security, content-security-policy, x-content-type-options
x-frame-options, referrer-policy, permissions-policy
cross-origin-opener-policy, cross-origin-resource-policy
```

Individual values are capped at 4 KiB and the collected allowlist is capped at 32 KiB. `Set-Cookie`, authorization data, response bodies, and arbitrary technology headers are excluded.

## Cache rules

The cache analyzer parses directives without asking a model. It reports `no-store`, `private`, `no-cache`, explicit freshness, missing policy, ambiguous policy, and conflicting evidence separately. `cf-cache-status` values and positive `Age` are used only as observed cache-result evidence. A single `MISS` does not establish a site's long-term hit ratio; `server: cloudflare` alone does not create a Cloudflare edge stage.

`ETag` and `Last-Modified` are recorded as revalidation validators. A future valid `Expires` value supplies freshness evidence. Conflicts such as `public, no-store` with a reported cache hit are surfaced instead of silently choosing one story.

## Security-header rules

Checks cover HSTS, CSP presence, `X-Content-Type-Options: nosniff`, frame protection through CSP `frame-ancestors` or `X-Frame-Options`, Referrer Policy, Permissions Policy, and Cross-Origin Opener Policy. HSTS is not assessed on a final HTTP response. Missing headers are described as contextual hardening opportunities, not automatic vulnerabilities. CSP presence is never presented as proof of policy quality.

## Infrastructure clues

Direct target values such as content type, encoding, length, server disclosure, `cf-ray`, and `cf-cache-status` are verified observations. CloudFront-style or intermediary header patterns are limited deterministic inferences. The ruleset intentionally avoids broad technology fingerprinting.

## Partial results

A redirect response remains evidence even if its destination is malformed, blocked, looping, excessive, or later times out. The adapter connects all completed stages to a terminal error stage, sets the investigation status to `failed`, and includes a structured `partialError`. No document-received stage appears when no final response was observed.
