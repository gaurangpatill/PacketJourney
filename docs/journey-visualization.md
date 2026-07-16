# Journey visualization

Status: Layer 2 complete on 2026-07-16.

## Layer 2 objective

Replace the Layer 1 stage strip with the central Packet Journey experience: a reusable, accessible, interactive graph that renders stable network journeys entirely from validated investigation data. Layer 2 remains fixture-only and introduces no networking or Cloudflare runtime integration.

## Audit and schema assessment

`JourneyStage.connections` already defines directed topology independently of rendering. Stage type, status, duration, evidence confidence, and the existing `branch` grouping hint are sufficient for branching, parallel work, warning/error termination, bottlenecks, and inferred dependencies.

No visualization-specific coordinates or library objects will be added to the investigation schema. Comparison journeys can later render two independently adapted investigations, so they do not require a Layer 2 schema change.

Fixture limitations found during the audit:

- Cache-miss journeys currently jump from origin directly to browser rather than representing the response returning through the edge.
- The third-party-heavy scenario branches to analytics, advertising, support, and one generic first-party asset group, but does not exercise font, script, and image resource categories.
- Connection semantics such as redirect, failure, resource, inferred, and return path are implicit. A deterministic adapter must classify them from connected stage types and evidence.
- `branch` is a grouping hint, not a coordinate. Layout must remain stable when it is absent or repeated.

## Likely files

- `src/features/journey/graph.ts` — library-neutral graph adapter and relationship classification.
- `src/features/journey/layout.ts` — deterministic left-to-right layered layout.
- `src/features/journey/JourneyCanvas.tsx` — SVG rendering and viewport interaction.
- `src/features/journey/JourneyTimeline.tsx` — playback and stage scrubbing.
- `src/features/journey/useJourneyController.ts` — synchronized selection and playback state.
- `src/features/investigation/InvestigationWorkspace.tsx` — graph, timeline, and inspector integration.
- `src/data/investigations.ts` — required fixture-shape corrections and expansion.
- `src/styles/global.css` — Packet Journey graph, controls, timeline, and mobile inspector styles.
- Tests adjacent to adapter, layout, canvas, timeline, and workspace components.
- README and architecture/data-model/implementation-plan documentation.

## Adapter design

The adapter maps `Investigation` into immutable `GraphNode` and `GraphEdge` values. It determines primary versus secondary paths, relationship type, evidence confidence, failure termination, selected/dimmed state inputs, and the measured bottleneck. UI state stays outside the canonical investigation model.

Malformed connections are ignored defensively by the adapter and remain rejected by the runtime investigation schema. Stable IDs are derived from source and target IDs, making repeated generation deterministic.

## Layout strategy

A custom layered directed-graph layout keeps the runtime small and gives Packet Journey full control over accessibility and visual design. The algorithm assigns ranks using directed topology, preserves investigation order as a stable tie-breaker, centers the primary path, places parallel branches in deterministic lanes, and sizes the world bounds from actual nodes.

This approach fits the current graph sizes, avoids exposing the domain schema to a library API, and is independently testable. Layout is computed once per investigation and supports at least 50 nodes and 100 edges without DOM measurement.

## Interaction model

- Selecting a node updates the timeline and evidence inspector.
- Selecting an edge opens relationship details derived from its source and target evidence.
- Timeline scrubbing, skip controls, and playback reveal stages progressively.
- Fit and reset are distinct: fit frames the whole journey; reset restores a one-to-one centered view.
- Pointer dragging pans. Wheel and explicit controls zoom around the pointer or viewport center.
- Escape clears selection; arrow keys traverse connected or adjacent nodes; Enter and Space select the focused node.
- Journey changes trigger fit-to-view after responsive measurement.

Reduced-motion users receive immediate reveals and no moving edge signal. Controls, status text, icons, borders, line patterns, and accessible labels ensure that color is never the only status cue.

## Acceptance criteria

- All seven seeded investigations render from their data with no scenario-specific positioning.
- Cache hit skips origin; cache miss returns through edge; redirect hops remain distinct; TLS failure terminates; slow origin is marked as bottleneck; third parties visibly branch; cache warning remains attached to cache.
- Nodes and edges can be selected by pointer and keyboard.
- Zoom, pan, fit, reset, responsive resizing, and reduced motion work.
- Timeline playback, pause, restart, scrub, stage skip, and graph selection remain synchronized.
- Inspector shows node or relationship details, confidence, sources, timestamps, and related findings at expertise-appropriate depth.
- Empty and malformed adapter inputs degrade safely.
- A synthetic 50-node/100-edge graph adapts and lays out without overlap or unstable output.
- Formatting, strict type checking, zero-warning lint, unit/component tests, production build, full dependency audit, and development smoke tests pass.

## Layer 2 result

The implementation meets the acceptance criteria with 42 passing tests, a clean production build and dependency audit, and browser-verified fixture rendering. No graph dependency or state-management library was added. Networking and Cloudflare runtime work remain outside this layer.
