# Architecture

Packet Journey separates collection, interpretation, and presentation.

1. A Cloudflare Worker validates and normalizes an input URL.
2. A restricted orchestration layer invokes small deterministic diagnostic tools.
3. Tools emit structured evidence with provenance, timing, confidence, and partial-error metadata.
4. Deterministic rules derive findings that do not need a model.
5. The AI investigator may select approved tools and explain collected evidence, but cannot fetch arbitrary URLs or create protocol facts.
6. The React client renders one normalized investigation model as a graph, timeline, evidence inspector, and concise findings.

Cloudflare services are introduced only with a concrete responsibility: Workers for APIs, Browser Rendering for page inspection, Queues for long browser jobs, Durable Objects for active streamed state, D1 for metadata, R2 for large artifacts, AI Gateway and Workers AI for model operations, and Vectorize only if documentation retrieval proves useful.

See [implementation-plan.md](./implementation-plan.md) for the data-flow diagram and staged rollout.
