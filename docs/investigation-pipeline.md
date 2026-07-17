# Investigation pipeline

Layer 5 extends the existing endpoint into one coherent deterministic network-and-browser pipeline:

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
  → isolated Cloudflare Browser Run navigation to the verified final URL
  → intercepted browser request validation
  → bounded navigation/resource/console/failure evidence
  → viewport screenshot in private R2
  → DNS/TLS/cache/security/infrastructure/browser rules
  → canonical Investigation runtime validation
  → graph, timeline, evidence inspector, screenshot, waterfall, and findings
```

Automatic redirect following is disabled. Each redirect response becomes its own diagnostic record and journey stage with source URL, status, raw `Location`, canonical destination, validation result, duration, allowlisted headers, and collection timestamp. DNS/TLS stages are inserted after a redirect when the hostname changes, or after an HTTP→HTTPS redirect when TLS first becomes relevant. Identical host evidence is not duplicated.

The Worker HTTP stage is titled **Document response received by Worker** and remains distinct from Browser Run. When Browser Run succeeds or partially collects evidence, the adapter appends **Browser investigation**, a primary **Rendered document observed** stage, and bounded secondary resource/third-party groups. When its binding is unavailable, a warning stage states that no browser step occurred.

Direct request/body/URL and prohibited-network failures return a structured API error. A public hostname that fails resolution returns an input → DNS → terminal-error investigation without starting TLS, HTTP, or a browser. Once journey evidence exists, later DNS, redirect, timeout, and upstream failures return a failed canonical investigation plus `partialError`. An unavailable certificate probe remains a warning. Browser launch, navigation, collection, screenshot, or R2 failure preserves the complete HTTP journey and returns an explicit partial/unavailable browser stage rather than a top-level API failure.

Only target response headers on an explicit allowlist are retained. Worker body streams are cancelled immediately. HTTP hop duration measures Worker `fetch` until response headers are available. DNS and certificate durations measure independent diagnostic operations. Browser navigation and paint values come from Performance APIs inside a separate lab session and never fill unavailable Worker DNS/TCP/TLS phases.

The orchestrator investigates at most three unique hostname/protocol boundaries and at most three certificates, prioritizing the initial URL, final URL, and meaningful domain transitions. Per-request query caching deduplicates safety and displayed DNS work without adding persistence.

The seven seeded investigations remain recorded examples at the presentation boundary. Live failure never falls back to them. Layer 5 browser evidence uses the same canonical graph boundary; Layer 6 has not started.
