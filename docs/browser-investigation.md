# Browser investigation

Layer 5 adds one isolated Cloudflare Browser Run session after the deterministic DNS, certificate, redirect, and HTTP investigation reaches a final public document. It uses the existing `POST /api/v1/investigations/http` response and canonical `Investigation` schema; the browser collector never emits graph-library data and never replaces earlier evidence.

## Runtime and lifecycle

The Worker receives a typed `BROWSER` binding and launches Cloudflare's `@cloudflare/playwright` client only when `BROWSER_ENABLED` is true and a final HTTP response exists. Each run creates a fresh context and page with a fixed 1440 × 900 viewport, service workers blocked, downloads disabled, no user cookies, no authentication, and a fixed Packet Journey user agent.

The lifecycle is bounded and logged:

```text
verified final URL
  → launch Browser Run session
  → create isolated context and page
  → install navigation/subresource interception
  → navigate with a 20-second deadline
  → collect document, Performance API, resource, failure, and console evidence
  → capture a viewport screenshot
  → write screenshot bytes to private R2
  → close page, context, and browser in finally
```

The complete browser phase has a 25-second application deadline. Page, context, and browser cleanup each have an additional two-second close bound. A launch, page, navigation, collection, artifact, or close problem is returned as structured browser evidence and does not discard DNS, TLS, redirect, HTTP, cache, or security results.

## Navigation safety

The browser is not a bypass around Layer 3's SSRF policy. The initial browser URL is the final URL already normalized, DNS-checked, and fetched by the Worker. Playwright routing then evaluates every HTTP(S) top-level navigation and subresource through the same hostname resolver and public-address classifier used by the HTTP collector. Results are cached only inside one investigation.

The browser blocks localhost, local-only names, metadata endpoints, credentials, non-HTTP top-level protocols, and any DNS answer containing a private, loopback, link-local, carrier-grade NAT, reserved, multicast, or otherwise prohibited address. Safe cross-domain redirects are allowed after validation. Top-level navigation stops after eight redirects. Passive `data:`, `blob:`, and `about:` URLs are permitted only as subresources because they do not initiate an external socket by themselves. Blocked network requests are retained as bounded failure evidence.

This remains defense in depth, not perfect DNS-rebinding prevention. Playwright routing validates a resolver observation before allowing Chromium to connect, but Browser Run does not expose a supported mechanism to pin that connection to the checked address. A DNS change between validation and connection remains a time-of-check/time-of-use limitation and is displayed as such.

## Evidence model

Browser evidence is separate from Worker-fetch evidence and records its own source and timestamp. It includes:

- requested and final browser URL, with credentials, query strings, and fragments removed from displayed resource URLs;
- page title, main-document status and content type, redirect count, viewport, readiness, and collection duration;
- navigation response-start, DOMContentLoaded, load, First Paint, First Contentful Paint, and Largest Contentful Paint when Performance API values are finite and available;
- document, script, stylesheet, image, font, fetch, XHR, iframe, media, WebSocket, preflight, and other resources;
- status, content type, protocol label, Resource Timing values, failure state, and before-render milestone flags where directly observed;
- console errors, warnings, uncaught page errors, blocked requests, collection errors, and limitations.

Performance values are relative to one navigation in one isolated lab session. They are not real-user monitoring, a percentile, a Lighthouse score, or proof of causation. Cross-origin timing restrictions and caching can make transfer sizes unavailable or zero. Unsupported values remain absent.

## Bounded resource collection

The collector counts all request events, keeps mutable detail for at most 500 observations, and returns at most 150 ranked resources across at most 40 domains. At most 30 failed resources and 40 console entries are retained. Failed and likely render-blocking resources rank ahead of slower remaining resources. Aggregate counts and bytes use the complete bounded collection rather than only the displayed rows, and truncation is explicit.

First-party classification compares registrable domains with the public suffix list through `tldts`; it is not a same-origin claim. Third-party categories use a short documented hostname/type ruleset for analytics, advertising, authentication, payments, error monitoring, customer support, tag management, fonts, media, and common CDNs. Unrecognized services remain `unknown`; vendor ownership and business purpose are not guessed.

Render-blocking labels are candidates only. A stylesheet link or synchronous external script discovered in the document is relevant evidence, but Packet Journey does not claim it caused a measured delay without a controlled comparison.

## Findings rules

Deterministic browser findings cover browser unavailability/timeouts, browser and Worker final-URL differences, large total or JavaScript transfer, many third parties, failed critical candidates, multiple render-blocking candidates, slow FCP in this lab run, repeated console errors, and incomplete screenshots. Each finding cites browser evidence IDs and uses careful language such as “observed” and “may.” A failed optional image does not become a critical-resource finding.

## Journey and interface integration

The adapter inserts one browser-investigation stage after the Worker document stage, then a primary rendered-document stage. Bounded resource and third-party groups branch from browser investigation as secondary paths; the core request journey remains visually primary. The existing graph adapter, timeline, expertise modes, keyboard behavior, reduced-motion behavior, and inspector consume these ordinary canonical stages.

The Browser detail surface shows a protected screenshot and a searchable, sortable waterfall. Its empty, loading, expired, and retrieval-failure states never render a broken image. Beginner, Developer, and Network Engineer modes vary presentation depth, not collected facts.

## Queue decision

Layer 5 does not add Cloudflare Queues. The measured bounded local flow completes synchronously within the endpoint contract, and Browser Run already supplies the remote session. Adding a queue now would require job identity, status polling or streaming, retries, idempotency, and cancellation semantics before evidence shows that complexity is necessary. A future layer may introduce a queue if production traces demonstrate that synchronous browser sessions regularly exceed an acceptable request budget.

## Local development and tests

`npm run dev` starts Vite and Wrangler together. Wrangler supplies local Browser Run and R2 simulation without production credentials. Set `BROWSER_ENABLED=false` to exercise the explicit unavailable path. Tests use fixture browser objects, resolver responses, and R2 bindings; the primary suite does not depend on public pages or the live Browser Run service.

See [browser-artifacts.md](./browser-artifacts.md) for storage and access boundaries, [security.md](./security.md) for the full threat model, and [cloudflare-runtime.md](./cloudflare-runtime.md) for plan and runtime constraints.

## Layer 6 interpretation boundary

Browser collection remains deterministic and unchanged. The AI selector may include bounded performance summaries, resource groups, failures, console entries, and browser limitations, while excluding screenshot bytes, raw page content, cookies, and complete manifests. Read-only AI tools can regroup already collected browser evidence but cannot launch Browser Run, navigate, or access R2. A model interpretation never becomes browser evidence or replaces a deterministic browser finding.
