# Security model

User-submitted URLs are hostile input. The Layer 5 Worker and Browser Run interception policy form the authoritative safety boundary; client validation is only usability feedback.

## Implemented controls

- Accept only canonical `http:` and `https:` URLs up to 2,048 characters.
- Reject embedded credentials, malformed or zero ports, invalid host labels, fragments, and unsupported schemes.
- Canonicalize unusual WHATWG IPv4 forms before classification, including shortened, integer, and hexadecimal loopback forms.
- Reject loopback, private, carrier-grade NAT, link-local, unspecified, multicast, reserved/documentation/benchmark ranges, IPv6 unique-local and site-local ranges, transition/reserved ranges, and IPv4-mapped private IPv6 addresses.
- Reject `localhost`, single-label, metadata, and common local-only hostname suffixes.
- Query typed DNS records through the fixed Cloudflare DoH endpoint, fail closed when journey-critical resolution is unavailable, and reject network access if any observed A or AAAA answer is not public unicast.
- Reuse the same `ipaddr.js` classifier for displayed address evidence, SSRF decisions, redirects, and certificate-probe eligibility. There is no second private-range list.
- Bound DNS responses to 64 KiB, 128 normalized records, eight CNAME steps, 512 displayed TXT characters per value, three investigated hostnames, and per-host abort deadlines.
- Use `redirect: "manual"`; normalize and repeat the full hostname/IP policy before following every 301, 302, 303, 307, or 308 destination.
- Stop redirect loops, invalid or missing `Location` values, unsupported protocols, blocked destinations, and chains exceeding eight followed redirects while retaining completed evidence.
- Send a fixed `GET` request with no user headers, cookies, authorization, method, or body. Cancel the response body after headers are collected.
- Enforce 8-second per-hop and 20-second overall defaults, bounded environment overrides, an allowlist-only 32 KiB collected-header budget, and 4 KiB API request bodies.
- Never collect `Set-Cookie`, authorization, arbitrary response bodies, or stack traces. Response data is runtime validated and React escapes displayed values.
- Emit structured logs with request IDs and sanitized error classification; target URLs and sensitive headers are not logged.
- Apply a native Workers Rate Limiting binding before parsing or diagnostic work. The default permits 20 investigation requests per 60 seconds for a coarse client-network key in each Cloudflare location and returns a structured 429 when exhausted.
- Apply a second, stricter Browser Run limiter at three launches per 60 seconds before expensive work.
- Validate AI questions and full canonical payloads before inference; cap request/context/output/tool sizes; apply separate eight/client/minute and three/payload-hash/minute AI abuse guards.
- Treat every page-derived string as untrusted evidence, keep it out of system instructions, and expose no AI tool capable of network access, code execution, binding access, or evidence mutation.
- Route inference through AI Gateway with cache skipped, one-attempt retry behavior, bounded metadata, and no application log of full questions, prompts, evidence, or model responses.
- Reject invalid schema, evidence/stage/finding references, category-mismatched citations, graph mutations, excessive confidence, and unsupported causal phrasing before rendering.

## Browser navigation boundary

- Start Browser Run only after the final HTTP URL has passed normalization, DNS checks, redirect validation, and target fetch.
- Create a fresh context without user cookies, credentials, authorization, local storage, or existing browser state; block service workers and downloads.
- Intercept top-level and subresource requests and reuse the canonical hostname resolver and IP classifier before allowing HTTP(S) network access.
- Block non-HTTP top-level navigation, localhost, metadata, private/reserved answers, and redirects beyond eight hops. Allow passive `data:`, `blob:`, and `about:` URLs only as embedded resources.
- Bound the browser phase to 25 seconds, navigation to 20 seconds, mutable resource capture to 500 requests, returned rows to 150/40 domains/30 failures, console output to 40 entries, URL/message lengths, and screenshots to 1.5 MB.
- Remove URL credentials, query strings, and fragments from displayed resource/source URLs and sanitize console control characters.
- Close page, context, and browser in `finally`; cleanup failures are structured logs and never erase collected evidence.

Browser request interception cannot pin Chromium's connection to the resolver answer it checked. This is the same class of time-of-check/time-of-use rebinding limitation as Worker fetch, and Packet Journey does not describe interception as a complete SSRF guarantee.

## Screenshot and R2 boundary

The Browser Run context contains no user session, but screenshots can still contain public page content. Bytes are written to a private R2 binding under a generated UUID-derived key; submitted URLs are never keys or metadata. Canonical JSON contains metadata only. The read-only Worker route accepts only an opaque UUID, derives the internal prefix, enforces a recorded 24-hour expiry, emits restrictive image headers, and exposes no list/write/delete/raw-key operation.

Layer 5 has no authentication, so a screenshot URL is a short-lived bearer reference rather than organization-private access control. Production buckets should add a one-day lifecycle deletion rule. Authentication and ownership checks belong to the later persistence layer and must precede private/authenticated page capture.

## Certificate acquisition boundary

Certificate inspection occurs only after URL normalization, DNS collection, and public-address validation. The direct mechanism is restricted to port 443, a prevalidated public address, and SNI equal to the requested hostname; no user-selected socket destination or port is exposed. Workers or target policy may reject that independent socket even when normal `fetch` succeeds.

When the peer probe is unavailable, Packet Journey calls the fixed SSLMate Cert Spotter issuance endpoint. It sends only the normalized, prevalidated hostname—not the URL path, query, response data, resolved address, cookies, or user identity. Responses are bounded to 256 KiB, schema validated, SAN-limited, timed out, and labeled `certificate-transparency`. CT output is trusted only as evidence that an issuance appeared in monitored transparency logs. It is not independently verified as the certificate currently served by the target, so it cannot produce expired/mismatch claims about the HTTP fetch session.

`CERTSPOTTER_API_TOKEN` is optional for local evaluation and recommended for production-volume access. It is read only from the Worker environment and should be installed with Wrangler secrets. The value is never logged, returned, or sent to the investigated target.

## DNS rebinding limitation

The Workers Fetch API does not expose the resolved peer address and does not provide a way to pin a hostname fetch to the exact DoH answer while preserving normal TLS hostname verification. The DoH preflight therefore detects observed private answers but leaves a time-of-check/time-of-use gap if DNS changes between preflight and target fetch. Redirect revalidation and fail-closed resolution reduce the attack surface, but Packet Journey does not claim perfect rebinding prevention. The direct certificate probe is address-pinned when the runtime permits it; the fixed CT fallback does not connect to the submitted destination.

Both bindings are intentionally abuse brakes, not accurate accounting: Cloudflare documents native counters as permissive, eventually consistent, and local to each location, and shared IPs may group legitimate users. Per-user or organization quotas await the identity model in a later layer.

## AI trust boundary

The model receives a bounded copy of the submitted investigation, not authority over Worker diagnostics. Prompt-like page titles, TXT values, headers, console strings, certificate fields, URLs, and errors remain JSON data. The tool registry reads only the already supplied investigation and cannot perform target fetches. Output validation reduces structural and citation failures but cannot prove every interpretation semantically correct; confidence and uncertainty remain visible.

Layer 6 has no server-side investigation store or signing key. A malicious client can submit a schema-valid fabricated investigation, so diagnosis is not evidence provenance. Gateway account logging/retention is an operator responsibility. See [ai-trust-boundary.md](./ai-trust-boundary.md).

Queues were not introduced because the bounded synchronous browser flow fits the current endpoint contract. If production evidence later requires queued retries, they must be bounded and idempotent. Organization audit trails and durable access permissions remain unimplemented.
