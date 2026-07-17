# Cloudflare Workers runtime notes

Layer 3 uses Wrangler 4, an ES-module Worker, and a dated `wrangler.jsonc` compatibility contract. `npm run dev:worker` runs locally without Cloudflare credentials; `npm run build:worker` performs a production dry run.

## Capabilities used

- Standard Workers `fetch`, `Request`, `Response`, `Headers`, `AbortController`, `performance.now()`, Web Crypto UUIDs, and streaming body cancellation.
- Environment variables for environment label, exact CORS origins, and bounded timeout overrides.
- Workers observability for structured console events and per-request correlation IDs.
- Workers Rate Limiting binding for a 20-request/60-second investigation abuse guard in each Cloudflare location.
- Cloudflare's public DNS-over-HTTPS endpoint as a security preflight, not as displayed Layer 4 DNS evidence.

## Runtime constraints

- Outbound target redirects use `manual`. Wrangler's local runtime rejects `redirect: "error"`; fixed-endpoint DoH requests also use `manual` and reject any non-2xx response.
- Workers fetch resolves after response headers but does not expose DNS lookup, socket connect, TLS handshake, cipher, ALPN, peer address, or precise origin-only timing.
- Waiting on subrequests is wall time rather than CPU time, but Packet Journey still applies its own per-hop and overall deadlines because Workers does not impose the product's desired subrequest timeout.
- Free-plan invocations allow 50 subrequests and six simultaneous open connections. Packet Journey resolves A and AAAA sequentially and follows at most eight redirects, staying well below that subrequest budget.
- Workers permits response bodies larger than Packet Journey needs. The collector cancels every target body immediately after safe headers are copied.
- Worker response headers have a platform limit, but the application additionally restricts retained allowlisted values to 32 KiB.
- Native rate-limit counters are local, permissive, and eventually consistent. They protect upstream work but are not used for billing or exact quotas.

## Environments and deployment

The top-level Wrangler environment targets production; `preview` has a separate Worker name. Configure cross-origin client origins as environment variables rather than committing account-specific domains.

```bash
npm run dev
npm run build
npm run deploy:preview
npm run deploy:production
```

When the frontend and Worker are deployed on different origins, build the client with `VITE_API_BASE_URL=https://worker.example` and configure that exact frontend origin in `CORS_ALLOWED_ORIGINS`. CORS is a browser boundary, not an SSRF or authentication control.

## Known limitation

DoH preflight and the later target fetch perform separate resolution operations. Workers does not expose or pin the target connection's address, so DNS rebinding cannot be fully eliminated inside the standard Fetch API. This is documented as defense in depth rather than a complete guarantee.
