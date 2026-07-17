# Data model

The canonical investigation model distinguishes observations from conclusions.

- `EvidenceItem` is an observed or explicitly inferred fact with a source, collection timestamp, confidence kind, and typed value.
- `JourneyStage` groups evidence into a request-lifecycle step and connects to other stages by ID.
- `Finding` is a conclusion with severity, confidence, supporting evidence IDs, and an optional recommendation.
- `Investigation` owns lifecycle state, metrics, stages, findings, and artifact references.

Runtime schemas are authoritative. TypeScript types are inferred from those schemas so persisted data, Worker responses, fixtures, and UI state cannot drift silently.

The `live-http` scenario discriminator remains the backward-compatible name for the versioned live endpoint, now containing Layer 4 DNS and certificate stages as well as HTTP. `mock: false` identifies live Worker results; the existing seven scenario discriminators remain recorded examples with `mock: true`. Scenario is descriptive metadata and never drives graph layout.

The versioned API validates both envelopes:

```ts
type HttpInvestigationResponse = {
  investigation: Investigation;
  partialError?: InvestigationApiError;
};

type InvestigationErrorResponse = {
  error: InvestigationApiError;
};
```

DNS query/record/alias/address results, certificate observations, and HTTP diagnostic types are internal Worker contracts. The adapter maps them into evidence and stages; resolver responses, redirect indices, allowlisted headers, cache classifications, security checks, and error states do not leak visualization positions into the domain model.

DNS records are verified resolver observations. CNAME-chain reconstruction, address-range classification, and human-readable summaries are deterministic inferences. DNSSEC evidence stores the resolver's `AD`/status/comment source; a finding may say the resolver reported authentication or failure, but never promotes that into a complete domain-security verdict.

Certificate evidence includes `observationKind`. `served-peer` means the independent TLS probe exposed a peer certificate. `certificate-transparency` means a fixed CT search returned issuance metadata and does not identify the certificate used by Worker `fetch`. Unsupported fetch-session TLS fields are represented as the literal value `unavailable`, not omitted or inferred from HTTP protocol behavior.

Stage IDs and evidence IDs must be unique. Connections must reference an existing stage and cannot point back to the same stage. These runtime invariants make graph adaptation deterministic and prevent ambiguous selections.

## Visualization adapter model

`GraphNode`, `GraphEdge`, and positioned layout values are derived, transient client models. They are not persisted and are deliberately absent from the investigation schema. The adapter classifies primary, return, redirect, resource, inferred, and failure relationships using stage topology, types, status, and evidence. Coordinates are produced only by the layout function.

The `branch` field remains a semantic grouping hint for parallel work, not a coordinate or visualization-library lane ID. Real diagnostics may omit it; investigation order and topology provide stable fallbacks.

Simulated evidence will use a separate simulation marker and will never overwrite collected evidence. AI-generated explanations remain conclusions even when they cite verified evidence.

For live results, raw resolver records, peer/CT fields, and HTTP status/header/location observations are `verified` relative to their named source. Parsed cache dispositions, hostname coverage, alias chains, address classifications, and vendor/intermediary rules are `inferred`. Findings remain conclusions even when confidence is 1.0; every finding references existing evidence IDs and the schema rejects dangling references.
