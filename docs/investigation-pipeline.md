# Investigation pipeline

Layer 3 implements this concrete HTTP pipeline:

```text
Client URL
  → POST request schema validation
  → canonical URL normalization
  → hostname/IP SSRF policy
  → A and AAAA DoH safety preflight
  → bounded minimal GET (manual redirect mode)
  → allowlisted headers + Worker-observed duration
  → redirect destination normalization and safety revalidation
  → final HTTP response or structured terminal error
  → cache/security/infrastructure rules
  → canonical Investigation runtime validation
  → graph, timeline, evidence inspector, and findings
```

Automatic redirect following is disabled. Each redirect response becomes its own diagnostic record and journey stage with source URL, status, raw `Location`, canonical destination, validation result, duration, allowlisted headers, and collection timestamp.

The final `browser`-typed stage is titled **Document response received** and explicitly means receipt of the HTTP document response. It does not claim browser navigation, resource loading, first paint, or rendering.

Direct request/body/URL/policy failures return a structured API error. Once target HTTP evidence exists, later redirect, timeout, and upstream failures return HTTP 200 with a failed canonical investigation plus `partialError`. The graph ends at a typed error stage and never fabricates later success stages.

Only target response headers on an explicit allowlist are retained. Body streams are cancelled immediately. Hop duration measures the Worker `fetch` call until response headers are available; total duration includes safety checks, target requests, parsing, and adaptation. DNS, TCP, TLS, origin-only, and browser phase timings remain absent.

The seven seeded investigations remain recorded examples at the presentation boundary. Live failure never falls back to them. Layers 4 and 5 can add DNS/TLS and browser evidence without changing the graph boundary.
