# Security model

User-submitted URLs are hostile input. The Layer 3 Worker is the authoritative safety boundary; client validation is only usability feedback.

## Implemented controls

- Accept only canonical `http:` and `https:` URLs up to 2,048 characters.
- Reject embedded credentials, malformed or zero ports, invalid host labels, fragments, and unsupported schemes.
- Canonicalize unusual WHATWG IPv4 forms before classification, including shortened, integer, and hexadecimal loopback forms.
- Reject loopback, private, carrier-grade NAT, link-local, unspecified, multicast, reserved/documentation/benchmark ranges, IPv6 unique-local and site-local ranges, transition/reserved ranges, and IPv4-mapped private IPv6 addresses.
- Reject `localhost`, single-label, metadata, and common local-only hostname suffixes.
- Resolve hostname A and AAAA answers through the fixed Cloudflare DoH endpoint, fail closed when resolution is unavailable, and reject the destination if any observed answer is not public unicast.
- Use `redirect: "manual"`; normalize and repeat the full hostname/IP policy before following every 301, 302, 303, 307, or 308 destination.
- Stop redirect loops, invalid or missing `Location` values, unsupported protocols, blocked destinations, and chains exceeding eight followed redirects while retaining completed evidence.
- Send a fixed `GET` request with no user headers, cookies, authorization, method, or body. Cancel the response body after headers are collected.
- Enforce 8-second per-hop and 20-second overall defaults, bounded environment overrides, an allowlist-only 32 KiB collected-header budget, and 4 KiB API request bodies.
- Never collect `Set-Cookie`, authorization, arbitrary response bodies, or stack traces. Response data is runtime validated and React escapes displayed values.
- Emit structured logs with request IDs and sanitized error classification; target URLs and sensitive headers are not logged.
- Apply a native Workers Rate Limiting binding before parsing or diagnostic work. The default permits 20 investigation requests per 60 seconds for a coarse client-network key in each Cloudflare location and returns a structured 429 when exhausted.

## DNS rebinding limitation

The Workers Fetch API does not expose the resolved peer address and does not provide a way to pin a hostname fetch to the exact DoH answer while preserving normal TLS hostname verification. The DoH preflight therefore detects observed private answers but leaves a time-of-check/time-of-use gap if DNS changes between preflight and target fetch. Redirect revalidation and fail-closed resolution reduce the attack surface, but Packet Journey does not claim perfect rebinding prevention.

The binding is intentionally an abuse brake, not accurate accounting: Cloudflare documents it as permissive, eventually consistent, and local to each location, and shared IPs may group legitimate users. Per-user or organization quotas await the identity model in a later layer.

Browser Rendering will require a separate navigation and subresource policy in Layer 5. Queue retry limits, artifact retention, organization audit trails, and storage permissions belong to the later services that introduce those capabilities.
