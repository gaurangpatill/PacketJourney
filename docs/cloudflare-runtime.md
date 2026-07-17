# Cloudflare Workers runtime notes

Layer 5 uses Wrangler 4, an ES-module Worker, `nodejs_compat`, and a dated `wrangler.jsonc` compatibility contract. `npm run dev:worker` runs locally without Cloudflare credentials; `npm run build:worker` performs a production dry run.

## Capabilities used

- Standard Workers `fetch`, `Request`, `Response`, `Headers`, `AbortController`, `performance.now()`, Web Crypto UUIDs, and streaming body cancellation.
- Environment variables for environment label, exact CORS origins, and bounded timeout overrides.
- Workers observability for structured console events and per-request correlation IDs.
- Workers Rate Limiting binding for a 20-request/60-second investigation abuse guard in each Cloudflare location.
- Cloudflare's public 1.1.1.1 DNS-over-HTTPS JSON endpoint for both public-address safety checks and displayed recursive resolver evidence.
- The supported `node:tls` client surface for a fixed-port, SNI-scoped peer certificate attempt after public-address validation.
- Standard Worker `fetch` to the fixed Cert Spotter API when the peer probe is unavailable.
- A typed Browser Run binding and `@cloudflare/playwright` 1.3.0 (Playwright 1.58.2 compatibility) for isolated browser lifecycle, routing, events, Performance API evaluation, and screenshots.
- A private R2 binding for screenshot bytes and metadata, with local simulation through Wrangler.
- A second Rate Limiting binding for the three-browser-runs/60-second expensive-work guard.

## Runtime constraints

- Outbound target redirects use `manual`. Wrangler's local runtime rejects `redirect: "error"`; fixed-endpoint DoH requests also use `manual` and reject any non-2xx response.
- Workers fetch resolves after response headers but does not expose outbound DNS lookup, socket connect, TLS handshake, cipher, ALPN, peer chain, peer address, or precise origin-only timing.
- Incoming `request.cf.tlsVersion` describes the client→Cloudflare request and is never used as evidence about the investigated destination.
- Cloudflare documents a Node TLS client API, but Workers socket policy may reject direct port-443 probing. Local validation observes this restriction, so certificate-probe failure is a warning and CT issuance data is used only as a labeled fallback.
- The DoH JSON schema is provider-specific rather than an IETF-standard wire-format contract. Packet Journey runtime-validates and bounds it; future wire-format replacement can stay behind the same typed interface.
- Waiting on subrequests is wall time rather than CPU time, but Packet Journey still applies its own per-hop and overall deadlines because Workers does not impose the product's desired subrequest timeout.
- Packet Journey performs DNS work sequentially, caches identical queries within one investigation, inspects at most three hostnames/certificates, and follows at most eight redirects. It avoids unbounded fan-out and stays below configured subrequest/concurrency limits for supported plans.
- Workers permits response bodies larger than Packet Journey needs. The collector cancels every target body immediately after safe headers are copied.
- Worker response headers have a platform limit, but the application additionally restricts retained allowlisted values to 32 KiB.
- Native rate-limit counters are local, permissive, and eventually consistent. They protect upstream work but are not used for billing or exact quotas.
- Browser Run was renamed from Browser Rendering in April 2026; the current binding and service are documented under Browser Run. It requires `nodejs_compat` and a compatibility date at or after 2025-09-15.
- Browser Run sessions default to a 60-second inactivity timeout and allow at most ten minutes of keepalive. Packet Journey is stricter: 20 seconds for navigation and 25 seconds for the complete browser phase, followed by cleanup in `finally`.
- Current Browser Run Free-plan limits include ten browser minutes per day, three concurrent browsers, and one new browser every 20 seconds. Paid-plan limits are higher. Packet Journey's application limiter remains necessary because platform concurrency is not user-level abuse control.
- Local `wrangler dev` supports Browser Run and simulated R2. Local Browser Run requests above 1 MB have a documented limitation, so public validation uses small pages and deterministic fixtures remain the primary tests.
- Browser request/response events and Performance APIs expose page-level evidence, but do not turn the separate Worker fetch into a browser connection trace. Transfer size can be missing for cross-origin/cached resources.
- R2 Worker bindings provide `put`/`get`; buckets remain private unless explicitly exposed. Packet Journey exposes only a derived, read-only artifact route and does not configure a public bucket.

## Environments and deployment

The top-level Wrangler environment targets production; `preview` has a separate Worker name. Configure cross-origin client origins as environment variables rather than committing account-specific domains.

```bash
npm run dev
npm run build
npm run deploy:preview
npm run deploy:production
```

When the frontend and Worker are deployed on different origins, build the client with `VITE_API_BASE_URL=https://worker.example` and configure that exact frontend origin in `CORS_ALLOWED_ORIGINS`. CORS is a browser boundary, not an SSRF or authentication control.

For production-volume CT fallback requests, install the SSLMate token as a Worker secret:

```bash
npx wrangler secret put CERTSPOTTER_API_TOKEN
```

No Cloudflare account API token is read by application code. Wrangler authentication is used only by the deployment CLI. Preview/production require the private `packet-journey-browser-artifacts-preview` and `packet-journey-browser-artifacts` buckets configured in `wrangler.jsonc`; configure a one-day lifecycle deletion rule for the screenshot prefix.

## Known limitation

DoH preflight and the later target fetch perform separate resolution operations. Workers does not expose or pin the target connection's address, so DNS rebinding cannot be fully eliminated inside the standard Fetch API. This is documented as defense in depth rather than a complete guarantee.

The independently attempted peer certificate connection is not the HTTP subrequest. When it succeeds, it proves only what that separate connection observed. When it fails, the CT fallback proves only that an issuance was logged. TLS protocol, cipher, ALPN, TCP timing, handshake timing, and the peer chain selected during Worker `fetch` remain unavailable in both cases.

Browser Run adds a second connection made by Chromium. Its Performance API values describe that isolated page navigation, not the Worker fetch or a real user's session. Playwright request interception reduces unsafe navigation risk but cannot pin the Chromium socket to the DoH answer checked immediately beforehand.
