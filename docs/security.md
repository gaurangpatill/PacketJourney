# Security model

User-submitted URLs are hostile input. The Layer 4 Worker is the authoritative safety boundary; client validation is only usability feedback.

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

## Certificate acquisition boundary

Certificate inspection occurs only after URL normalization, DNS collection, and public-address validation. The direct mechanism is restricted to port 443, a prevalidated public address, and SNI equal to the requested hostname; no user-selected socket destination or port is exposed. Workers or target policy may reject that independent socket even when normal `fetch` succeeds.

When the peer probe is unavailable, Packet Journey calls the fixed SSLMate Cert Spotter issuance endpoint. It sends only the normalized, prevalidated hostname—not the URL path, query, response data, resolved address, cookies, or user identity. Responses are bounded to 256 KiB, schema validated, SAN-limited, timed out, and labeled `certificate-transparency`. CT output is trusted only as evidence that an issuance appeared in monitored transparency logs. It is not independently verified as the certificate currently served by the target, so it cannot produce expired/mismatch claims about the HTTP fetch session.

`CERTSPOTTER_API_TOKEN` is optional for local evaluation and recommended for production-volume access. It is read only from the Worker environment and should be installed with Wrangler secrets. The value is never logged, returned, or sent to the investigated target.

## DNS rebinding limitation

The Workers Fetch API does not expose the resolved peer address and does not provide a way to pin a hostname fetch to the exact DoH answer while preserving normal TLS hostname verification. The DoH preflight therefore detects observed private answers but leaves a time-of-check/time-of-use gap if DNS changes between preflight and target fetch. Redirect revalidation and fail-closed resolution reduce the attack surface, but Packet Journey does not claim perfect rebinding prevention. The direct certificate probe is address-pinned when the runtime permits it; the fixed CT fallback does not connect to the submitted destination.

The binding is intentionally an abuse brake, not accurate accounting: Cloudflare documents it as permissive, eventually consistent, and local to each location, and shared IPs may group legitimate users. Per-user or organization quotas await the identity model in a later layer.

Browser Rendering will require a separate navigation and subresource policy in Layer 5. Queue retry limits, artifact retention, organization audit trails, and storage permissions belong to the later services that introduce those capabilities; none are implemented in Layer 4.
