# Packet Journey

Packet Journey is an AI-assisted network investigation environment that reconstructs, visualizes, and diagnoses the path from a URL to a rendered webpage.

The project is being built in validated layers. Layers 1 and 2 are complete: a production-shaped frontend and an interactive journey graph backed by realistic seeded investigation data. Live diagnostics are not represented as complete until their corresponding milestones pass validation.

![Packet Journey third-party dependency visualization](./docs/assets/journey-visualization.png)

## Current product experience

- A cinematic, responsive landing page with URL intake and an animated-style request preview.
- Seven stable demo investigations with genuinely different request paths.
- A deterministic left-to-right graph with directed edges, stable parallel branches, cache return paths, redirect chains, and failure termination.
- Pointer and keyboard node/edge selection, pan, zoom, fit, reset, related-stage dimming, and responsive resize behavior.
- A synchronized timeline with playback, pause, restart, stage skipping, and progressive reveal.
- An evidence inspector for stages and relationships, including verified/inferred provenance, timestamps, related findings, and bottleneck status.
- Beginner, developer, and network-engineer explanation modes over one evidence model.
- Deliberate loading, empty, invalid URL, missing investigation, TLS failure, and mobile states.

All current protocol evidence is marked as recorded fixture data. Layer 2 does not perform network requests; live HTTP collection begins in Layer 3.

## Architecture

```mermaid
flowchart LR
    URL[Public URL] --> SAFE[Validation and SSRF boundary]
    SAFE --> TOOLS[Deterministic diagnostic tools]
    TOOLS --> EVIDENCE[Normalized evidence]
    EVIDENCE --> RULES[Deterministic findings]
    EVIDENCE --> AI[Restricted AI investigator]
    RULES --> MODEL[Investigation model]
    AI --> MODEL
    MODEL --> UI[Journey, inspector, and findings]
```

The browser UI is React with strict TypeScript and Zod runtime schemas. A library-neutral adapter derives graph nodes, relationship edges, primary/secondary paths, confidence, and bottlenecks. A custom layered SVG layout renders that model without storing coordinates in the investigation schema. The planned backend uses Cloudflare Workers for orchestration, then adds Browser Rendering, Queues, Durable Objects, D1, and R2 only where their responsibilities become necessary. Workers AI is downstream of evidence and routed through AI Gateway.

## Request lifecycle

The target lifecycle is intake → normalization → public-network safety validation → deterministic HTTP/DNS/TLS/browser tools → normalized evidence → deterministic findings → optional AI explanation → adaptive journey rendering. See [the pipeline design](./docs/investigation-pipeline.md) for failure and partial-result behavior.

## Local development

Requirements: Node.js 22+ and npm 10+.

```bash
npm install
npm run dev
```

Vite prints the local development URL. No environment variables or Cloudflare credentials are required through Layer 2.

## Quality checks

```bash
npm run format
npm run typecheck
npm run lint
npm run test
npm run build
npm audit
```

The current suite covers URL normalization, schema integrity, graph adaptation, cache hits/misses, redirects, failure termination, third-party branching, deterministic layout, 50-node/100-edge performance, selection, expertise modes, inspector updates, timeline synchronization, playback, reduced motion, routes, and form validation. Future network tests will use recorded fixtures instead of depending on live websites.

## Deployment

`npm run build` produces the static client in `dist/`. It can be deployed to Cloudflare Pages with SPA fallback to `index.html`. Worker deployment configuration will be added with Layer 3; there is intentionally no nonfunctional Worker manifest today.

## Environment variables

Layers 1 and 2 have none. Later milestones will document and validate Cloudflare binding names and model configuration without placing credentials in the client bundle.

## Security considerations

Client URL validation is a usability guard, not an SSRF defense. Live investigation will not ship until the Worker validates schemes, hostnames, resolved IPs, every redirect target, response limits, and timeouts as specified in [the security model](./docs/security.md). URLs containing credentials and non-HTTP(S) schemes are already rejected at intake.

## Design decisions

- Keep observations and conclusions separate; findings can cite evidence but cannot become evidence.
- Infer TypeScript types from runtime schemas to keep fixture, client, Worker, and persistence contracts aligned.
- Prefer token-driven CSS while the visual system is evolving.
- Show disabled future controls with their delivery layer instead of presenting placeholders as working features.
- Use deterministic seeded scenarios as a reliable portfolio/demo surface before live network behavior exists.
- Keep visualization state in a graph adapter and controller instead of contaminating the canonical investigation schema with coordinates or UI selection.
- Use a custom layered SVG layout for stable output, accessible HTML nodes, precise Packet Journey styling, and independent adapter/layout tests.

## Known limitations

- No live network, DNS, TLS, or browser collection yet.
- AI commands, simulations, persistence, sharing, export, and authentication are not active.
- Cloudflare bindings and deployment automation begin only when a working backend requires them.
- Layout is optimized for directed acyclic request journeys. Defensive cyclic input rendering exists, but cycle-specific routing is not a Layer 2 feature.
- Very large graphs are fit as an overview and may require user zoom; semantic clustering is deferred until real browser traces establish its rules.

## Roadmap

The next milestone is Layer 3: deterministic HTTP investigation with URL normalization, SSRF-safe fetch, redirect tracing, response timing, header analysis, CDN clues, structured failures, and fixture-backed tests. The remaining milestones are tracked in [the implementation plan](./docs/implementation-plan.md).

## Architecture and planning

- [Implementation plan](./docs/implementation-plan.md)
- [Architecture](./docs/architecture.md)
- [Investigation pipeline](./docs/investigation-pipeline.md)
- [Security model](./docs/security.md)
- [AI design](./docs/ai-design.md)
- [Data model](./docs/data-model.md)
- [Counterfactual engine](./docs/counterfactual-engine.md)
- [Journey visualization](./docs/journey-visualization.md)
