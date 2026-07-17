# Data model

The canonical investigation model distinguishes observations from conclusions.

- `EvidenceItem` is an observed or explicitly inferred fact with a source, collection timestamp, confidence kind, and typed value.
- `JourneyStage` groups evidence into a request-lifecycle step and connects to other stages by ID.
- `Finding` is a conclusion with severity, confidence, supporting evidence IDs, and an optional recommendation.
- `Investigation` owns lifecycle state, metrics, stages, findings, and artifact references.

Runtime schemas are authoritative. TypeScript types are inferred from those schemas so persisted data, Worker responses, fixtures, and UI state cannot drift silently.

Layer 3 adds the `live-http` scenario discriminator. `mock: false` identifies live Worker results; the existing seven scenario discriminators remain recorded examples with `mock: true`. Scenario is descriptive metadata and never drives graph layout.

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

HTTP diagnostic types are internal Worker contracts. The adapter maps them into evidence and stages; redirect indices, raw allowlisted headers, cache classifications, security checks, and error states do not leak visualization positions into the domain model.

Stage IDs and evidence IDs must be unique. Connections must reference an existing stage and cannot point back to the same stage. These runtime invariants make graph adaptation deterministic and prevent ambiguous selections.

## Visualization adapter model

`GraphNode`, `GraphEdge`, and positioned layout values are derived, transient client models. They are not persisted and are deliberately absent from the investigation schema. The adapter classifies primary, return, redirect, resource, inferred, and failure relationships using stage topology, types, status, and evidence. Coordinates are produced only by the layout function.

The `branch` field remains a semantic grouping hint for parallel work, not a coordinate or visualization-library lane ID. Real diagnostics may omit it; investigation order and topology provide stable fallbacks.

Simulated evidence will use a separate simulation marker and will never overwrite collected evidence. AI-generated explanations remain conclusions even when they cite verified evidence.

For live HTTP results, raw status/header/location observations are `verified`. Parsed cache dispositions and vendor/intermediary rules are `inferred` unless a target-specific header directly verifies the fact. Findings remain conclusions even when their confidence is 1.0; every finding references existing evidence IDs and the schema rejects dangling references.
