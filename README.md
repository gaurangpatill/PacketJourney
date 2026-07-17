# Packet Journey

Packet Journey is an AI-assisted network investigation environment that reconstructs, visualizes, and diagnoses the path from a URL to a rendered webpage.

The project is being built in validated layers. Layers 1–5 are complete: a production-shaped frontend, an interactive journey graph, and a deterministic Cloudflare Worker investigation pipeline for DNS, certificate, redirects, HTTP, browser resources, rendering milestones, screenshots, cache, and security evidence. AI remains explicitly unimplemented.

![Packet Journey browser-enabled journey](./docs/assets/browser-journey.png)

| Resource investigation                                                    | Rendered-page evidence                                                                           |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| ![Packet Journey resource waterfall](./docs/assets/browser-waterfall.png) | ![Rendered public example page captured by Browser Run](./docs/assets/browser-rendered-page.jpg) |

## Current product experience

- A cinematic, responsive landing page with URL intake and an animated-style request preview.
- Seven stable demo investigations with genuinely different request paths.
- A deterministic left-to-right graph with directed edges, stable parallel branches, cache return paths, redirect chains, and failure termination.
- Pointer and keyboard node/edge selection, pan, zoom, fit, reset, related-stage dimming, and responsive resize behavior.
- A synchronized timeline with playback, pause, restart, stage skipping, and progressive reveal.
- An evidence inspector for stages and relationships, including verified/inferred provenance, timestamps, related findings, and bottleneck status.
- Beginner, developer, and network-engineer explanation modes over one evidence model.
- Live network URL intake with stage-aware loading, structured retry/error states, and no fixture fallback.
- Bounded A, AAAA, CNAME, CAA, NS, MX, and sanitized TXT diagnostics with TTLs, CNAME reconstruction, address-policy results, and resolver-reported DNSSEC metadata.
- Independent certificate evidence with deterministic SAN coverage and validity checks; a clearly labeled Certificate Transparency fallback is used when a direct peer probe is unavailable.
- Manual redirect tracing, response status and timing, allowlisted headers, cache/security findings, and partial-result journeys.
- A real isolated Cloudflare Browser Run session with final browser URL, page title, document status, navigation/paint milestones, bounded resources, failures, console evidence, and cautious third-party classification.
- Private R2 screenshot storage with opaque IDs, 24-hour access expiry, a read-only Worker route, secure image headers, and deliberate loading/failure states.
- A searchable, sortable resource waterfall and evidence-driven browser/resource branches in the existing graph and timeline.
- Deliberate loading, empty, invalid URL, blocked destination, missing investigation, TLS failure, and mobile states.

The seven seeded demonstrations remain stable recorded examples. Live workspaces are labeled **Live network evidence** and contain only facts returned by deterministic tools or limited, explicitly labeled inferences with provenance.

## Architecture

```mermaid
flowchart LR
    UI[React client] -->|POST /api/v1/investigations/http| W[Cloudflare Worker]
    W --> N[URL normalization + SSRF policy]
    N --> DNS[Cloudflare 1.1.1.1 DoH diagnostics]
    DNS --> TLS[Bounded peer probe or labeled CT fallback]
    TLS --> R[Manual redirect tracer]
    R --> H[Allowlisted headers + timing]
    H --> B[Cloudflare Browser Run]
    B --> E[Bounded browser evidence]
    B --> R2[Private R2 screenshot]
    E --> D[Deterministic network/browser rules]
    R2 --> M[Validated Investigation schema]
    D --> M
    M --> UI
    DEMO[Recorded examples] --> UI
```

The React client and Worker share strict TypeScript and Zod runtime contracts. The Worker never returns graph coordinates; a library-neutral client adapter derives graph nodes, relationships, primary/secondary paths, confidence, and bottlenecks. Cloudflare Workers performs bounded deterministic orchestration, Browser Run collects isolated page evidence, R2 stores screenshot bytes, and two native Rate Limiting bindings protect general and browser work. Queues were intentionally omitted because the bounded synchronous path is currently reliable; D1, Durable Objects, Workers AI, AI Gateway, and Vectorize are not wired in.

## Request lifecycle

The Layer 5 lifecycle is intake → normalization → DNS records and public-address validation → independent certificate evidence → bounded manual redirects → HTTP header/timing collection → isolated browser navigation with per-request safety checks → resource/performance/console collection → private R2 screenshot → deterministic findings → canonical validation → adaptive rendering. Completed network evidence is retained when Browser Run or R2 fails. See [the pipeline design](./docs/investigation-pipeline.md).

## Local development

Requirements: Node.js 22+ and npm 10+.

```bash
npm install
npm run dev
```

`npm run dev` starts Vite on port 5173 and Wrangler on port 8787; Vite proxies `/api` to the Worker. Wrangler provides local Browser Run and R2 simulation, so local development and tests require no Cloudflare credentials. Copy `.dev.vars.example` to `.dev.vars` only when overriding local variables. Set `BROWSER_ENABLED=false` to verify the explicit HTTP-only degradation path. Limited unauthenticated Certificate Transparency lookup is suitable for evaluation; configure the optional Cert Spotter token for production use.

Useful split commands:

```bash
npm run dev:web
npm run dev:worker
npm run build:web
npm run build:worker
```

## Quality checks

```bash
npm run format
npm run typecheck
npm run lint
npm run test
npm run build
npm audit
```

The deterministic suite covers client and Worker URL handling, SSRF policy, DNS/TLS/HTTP collection, Browser Run lifecycle/cleanup, browser navigation safety, resource classification/bounds, performance and console normalization, R2 storage/retrieval, browser findings, canonical adaptation, API/CORS/error envelopes, graph behavior, accessibility interactions, and recorded journeys. Main tests use mocked responses and do not require public Internet access.

## Deployment

`npm run build` builds the static client and runs a Wrangler Worker dry run. Deploy the client to a static host with SPA fallback, then deploy the Worker with:

```bash
npm run deploy:preview
npm run deploy:production
```

Set `VITE_API_BASE_URL` at frontend build time when the API is on another origin. Configure `CORS_ALLOWED_ORIGINS` on the Worker as a comma-separated exact allowlist for those frontend origins.

Before the first preview/production Worker deployment, create the private R2 buckets named in `wrangler.jsonc` and configure a one-day lifecycle deletion rule for the `browser-screenshots/` prefix. Browser Run must be enabled for the account. Wrangler CLI authentication is deployment tooling; the application never reads a Cloudflare API token.

## Environment variables

- `VITE_API_BASE_URL` — optional public Worker origin; omitted for same-origin/proxied local requests.
- `ENVIRONMENT` — `development`, `preview`, `production`, or `test` label used in health output.
- `CORS_ALLOWED_ORIGINS` — optional comma-separated exact origin allowlist.
- `HTTP_HOP_TIMEOUT_MS` — optional 250–15,000 ms override; default 8,000 ms.
- `HTTP_OVERALL_TIMEOUT_MS` — optional 250–30,000 ms override; default 20,000 ms.
- `DNS_TIMEOUT_MS` — optional 250–10,000 ms per-host DNS diagnostic bound; default 5,000 ms.
- `CERTIFICATE_TIMEOUT_MS` — optional 250–10,000 ms per certificate mechanism; default 8,000 ms.
- `CERTSPOTTER_API_TOKEN` — optional SSLMate Cert Spotter token. Store it with `wrangler secret put CERTSPOTTER_API_TOKEN`; never expose it to the client.
- `BROWSER_ENABLED` — `true` or `false`; disables Browser Run cleanly while preserving the Layer 4 HTTP journey.

`BROWSER`, `BROWSER_ARTIFACTS`, `INVESTIGATION_RATE_LIMITER`, and `BROWSER_RATE_LIMITER` are typed Wrangler bindings, not secrets. No Cloudflare API token or AI model key is required by application code.

## Security considerations

Client URL validation is only a usability guard. The Worker independently rejects credentials, unsupported protocols, internal hostnames, private/reserved IPv4 and IPv6 ranges, IPv4-mapped bypasses, metadata addresses, and unsafe DNS answers. Every HTTP and browser destination is revalidated before connection where the runtimes permit interception. Browser contexts contain no user credentials or cookies, target Worker bodies are never consumed, output is bounded and sanitized, and R2 has no public bucket or arbitrary-key route. See [the security model](./docs/security.md) for the remaining DNS-rebinding limitation and artifact-link boundary.

## Design decisions

- Keep observations and conclusions separate; findings can cite evidence but cannot become evidence.
- Infer TypeScript types from runtime schemas to keep fixture, client, Worker, and persistence contracts aligned.
- Prefer token-driven CSS while the visual system is evolving.
- Show disabled future controls with their delivery layer instead of presenting placeholders as working features.
- Use deterministic seeded scenarios as a reliable portfolio/demo surface before live network behavior exists.
- Keep visualization state in a graph adapter and controller instead of contaminating the canonical investigation schema with coordinates or UI selection.
- Use a custom layered SVG layout for stable output, accessible HTML nodes, precise Packet Journey styling, and independent adapter/layout tests.
- Use Cloudflare's public DoH endpoint as a fail-closed hostname preflight while acknowledging that Workers cannot pin the later fetch to the preflight answer.
- Use minimal `GET` plus immediate body cancellation instead of relying on inconsistent `HEAD` support.
- Keep live HTTP results and recorded examples explicit; never silently substitute one for the other.
- Apply a coarse 20-request/minute, per-location/client-network Worker Rate Limiting binding before diagnostic work; do not treat it as identity or billing accounting.
- Run Browser Run only for a verified final document and protect it with a stricter three-request/minute abuse guard.
- Keep screenshot bytes out of canonical JSON and behind an opaque, expiring, Worker-mediated R2 read route.
- Defer Queues until measured production latency demonstrates that the bounded synchronous browser contract is unsuitable.

## Known limitations

- DNS data is recursive resolver evidence, not an authoritative-traversal trace. `AD` records the resolver's authentication signal and is not a complete DNSSEC security verdict.
- A direct `node:tls` peer probe can be unavailable under Workers socket policy. The fallback is a Certificate Transparency issuance, not proof of the certificate used by the target HTTP fetch.
- Workers fetch does not expose outbound TCP time, TLS handshake time, cipher, ALPN, selected peer chain, or origin-only time. Browser metrics come from a separate isolated Browser Run session.
- DoH preflight checks observed answers but cannot pin the target connection, so it reduces rather than eliminates DNS-rebinding risk.
- Some targets reject or treat data-center/Worker requests differently from browser traffic.
- Browser timings are one lab observation, not field performance; cross-origin timing policy and caching can make transfer bytes unavailable.
- Browser request interception rechecks DNS but cannot pin Chromium's later connection to the checked answer, leaving a documented rebinding gap.
- Screenshot links are opaque and short-lived but unauthenticated until the later identity layer; treat them as bearer links.
- AI commands, simulations, persistence, sharing, export, authentication, and organization controls are not active.
- No D1, Durable Objects, Queues, Workers AI, AI Gateway, or Vectorize integration exists yet.
- Layout is optimized for directed acyclic request journeys. Defensive cyclic input rendering exists, but cycle-specific routing is not a Layer 2 feature.
- Very large graphs are fit as an overview and may require user zoom; semantic clustering is deferred until real browser traces establish its rules.

## Roadmap

The next milestone is Layer 6: a broader deterministic findings engine. It has not started. The remaining milestones are tracked in [the implementation plan](./docs/implementation-plan.md).

## Architecture and planning

- [Implementation plan](./docs/implementation-plan.md)
- [Architecture](./docs/architecture.md)
- [Investigation pipeline](./docs/investigation-pipeline.md)
- [Security model](./docs/security.md)
- [AI design](./docs/ai-design.md)
- [Data model](./docs/data-model.md)
- [Counterfactual engine](./docs/counterfactual-engine.md)
- [Journey visualization](./docs/journey-visualization.md)
- [HTTP diagnostics](./docs/http-diagnostics.md)
- [Cloudflare runtime](./docs/cloudflare-runtime.md)
- [DNS and TLS diagnostics](./docs/dns-tls-diagnostics.md)
- [Browser investigation](./docs/browser-investigation.md)
- [Browser artifacts](./docs/browser-artifacts.md)
