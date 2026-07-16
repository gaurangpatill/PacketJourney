# Architecture

Packet Journey separates collection, interpretation, and presentation.

1. A Cloudflare Worker validates and normalizes an input URL.
2. A restricted orchestration layer invokes small deterministic diagnostic tools.
3. Tools emit structured evidence with provenance, timing, confidence, and partial-error metadata.
4. Deterministic rules derive findings that do not need a model.
5. The AI investigator may select approved tools and explain collected evidence, but cannot fetch arbitrary URLs or create protocol facts.
6. The React client renders one normalized investigation model as a graph, timeline, evidence inspector, and concise findings.

## Client visualization boundary

The canonical investigation model does not contain canvas positions or component state. A pure graph adapter converts stages and connections into library-neutral nodes and classified relationships, determines the primary path, joins related findings by evidence ID, and identifies the dominant measured duration. A deterministic layered layout then assigns stable left-to-right ranks and branch lanes.

The SVG canvas owns only viewport interaction. A shared journey controller synchronizes graph selection, timeline position, progressive reveal, playback, and reduced-motion behavior. The inspector reads the selected adapter node or edge and never mutates evidence.

This separation keeps future Worker responses independent of rendering technology and lets graph generation and layout be tested without a browser. See [journey-visualization.md](./journey-visualization.md).

Cloudflare services are introduced only with a concrete responsibility: Workers for APIs, Browser Rendering for page inspection, Queues for long browser jobs, Durable Objects for active streamed state, D1 for metadata, R2 for large artifacts, AI Gateway and Workers AI for model operations, and Vectorize only if documentation retrieval proves useful.

See [implementation-plan.md](./implementation-plan.md) for the data-flow diagram and staged rollout.
