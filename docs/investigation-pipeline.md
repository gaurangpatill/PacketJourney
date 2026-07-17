# Investigation pipeline

Layer 4 extends the existing endpoint into one coherent deterministic network pipeline:

```text
Client URL
  → POST request schema validation
  → canonical URL normalization
  → CNAME, A, AAAA, CAA, NS, MX, and bounded TXT DoH queries
  → shared hostname/IP SSRF policy
  → independent certificate probe for the initial HTTPS hostname
  → bounded minimal GET (manual redirect mode)
  → allowlisted headers + Worker-observed duration
  → redirect destination normalization and safety revalidation
  → deduplicated DNS and certificate evidence for meaningful HTTPS host changes
  → final HTTP response or structured terminal error
  → DNS/TLS/cache/security/infrastructure rules
  → canonical Investigation runtime validation
  → graph, timeline, evidence inspector, and findings
```

Automatic redirect following is disabled. Each redirect response becomes its own diagnostic record and journey stage with source URL, status, raw `Location`, canonical destination, validation result, duration, allowlisted headers, and collection timestamp. DNS/TLS stages are inserted after a redirect when the hostname changes, or after an HTTP→HTTPS redirect when TLS first becomes relevant. Identical host evidence is not duplicated.

The final `browser`-typed stage is titled **Document response received** and explicitly means receipt of the HTTP document response. It does not claim browser navigation, resource loading, first paint, or rendering.

Direct request/body/URL and prohibited-network failures return a structured API error. A public hostname that fails resolution returns an input → DNS → terminal-error investigation without starting TLS or HTTP. Once journey evidence exists, later DNS, redirect, timeout, and upstream failures return a failed canonical investigation plus `partialError`. An unavailable independent certificate probe remains a warning and does not discard successful HTTP evidence or claim certificate invalidity.

Only target response headers on an explicit allowlist are retained. Body streams are cancelled immediately. HTTP hop duration measures Worker `fetch` until response headers are available. DNS duration measures resolver subrequests; certificate duration measures the independent peer/CT mechanism as a whole. Neither is a DNS lookup or TLS handshake phase from the target HTTP request. TCP, outbound-fetch TLS, origin-only, and browser timings remain unavailable.

The orchestrator investigates at most three unique hostname/protocol boundaries and at most three certificates, prioritizing the initial URL, final URL, and meaningful domain transitions. Per-request query caching deduplicates safety and displayed DNS work without adding persistence.

The seven seeded investigations remain recorded examples at the presentation boundary. Live failure never falls back to them. Layer 5 can add browser evidence through the same canonical graph boundary.
