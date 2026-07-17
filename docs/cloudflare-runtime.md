# Cloudflare Workers runtime notes

Layer 4 uses Wrangler 4, an ES-module Worker, `nodejs_compat`, and a dated `wrangler.jsonc` compatibility contract. `npm run dev:worker` runs locally without Cloudflare credentials; `npm run build:worker` performs a production dry run.

## Capabilities used

- Standard Workers `fetch`, `Request`, `Response`, `Headers`, `AbortController`, `performance.now()`, Web Crypto UUIDs, and streaming body cancellation.
- Environment variables for environment label, exact CORS origins, and bounded timeout overrides.
- Workers observability for structured console events and per-request correlation IDs.
- Workers Rate Limiting binding for a 20-request/60-second investigation abuse guard in each Cloudflare location.
- Cloudflare's public 1.1.1.1 DNS-over-HTTPS JSON endpoint for both public-address safety checks and displayed recursive resolver evidence.
- The supported `node:tls` client surface for a fixed-port, SNI-scoped peer certificate attempt after public-address validation.
- Standard Worker `fetch` to the fixed Cert Spotter API when the peer probe is unavailable.

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

No Cloudflare account API token is read by application code. Wrangler authentication is used only by the deployment CLI.

## Known limitation

DoH preflight and the later target fetch perform separate resolution operations. Workers does not expose or pin the target connection's address, so DNS rebinding cannot be fully eliminated inside the standard Fetch API. This is documented as defense in depth rather than a complete guarantee.

The independently attempted peer certificate connection is not the HTTP subrequest. When it succeeds, it proves only what that separate connection observed. When it fails, the CT fallback proves only that an issuance was logged. TLS protocol, cipher, ALPN, TCP timing, handshake timing, and the peer chain selected during Worker `fetch` remain unavailable in both cases.
