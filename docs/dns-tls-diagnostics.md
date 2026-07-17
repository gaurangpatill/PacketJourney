# DNS and TLS diagnostics

Layer 4 established deterministic DNS and certificate evidence. Layer 5 preserves these modules unchanged and executes Browser Run only after their public-address policy and the HTTP redirect pipeline produce a verified final document. No AI or unrestricted network primitive is used.

## DNS source and query flow

Packet Journey queries Cloudflare's fixed `https://cloudflare-dns.com/dns-query` endpoint using the JSON DoH media type. Queries request DNSSEC data with validation enabled and are runtime validated before use. Journey-priority records are CNAME, A, AAAA, and CAA; NS, MX, and bounded TXT values are retained for the engineer inspector.

Each normalized record carries the queried hostname, owner, type, value, TTL when supplied, resolver source, query timestamp, and direct-observation marker. Responses are limited to 64 KiB and 128 retained records. TXT control characters are replaced and displayed values are limited to 512 characters.

The CNAME walker follows at most eight aliases, records TTL per step, deduplicates records, detects loops, and reports a missing terminal address without discarding earlier aliases. It does not infer provider ownership or latency from an alias name. A and AAAA records at the terminal hostname are parsed through the same IP classifier used by SSRF enforcement.

## DNSSEC interpretation

The DoH `AD` bit means the selected resolver reported every answer record as DNSSEC-verified. Packet Journey may state exactly that. A resolver status/comment explicitly describing DNSSEC bogus or validation failure can create an evidence-linked finding. `AD: false`, a missing field, or an unsigned response remains inconclusive/unavailable and never becomes a claim that the domain is insecure.

This is recursive-resolver evidence, not an authoritative delegation walk. Packet Journey does not yet query and validate the complete DS/DNSKEY/RRSIG chain independently.

## Address policy reuse

DNS diagnostics, initial URL validation, every redirect, and certificate eligibility share `src/worker/security/ip.ts` and the same SSRF policy. IPv4-mapped IPv6 addresses are reduced to their mapped range decision. If any observed destination answer is private, loopback, link-local, metadata, carrier-grade NAT, multicast, reserved, or otherwise prohibited, network access fails closed. Mixed public/prohibited answers are not treated as safe.

DoH validation and Worker `fetch` are separate resolution events. Fetch does not expose or pin its peer address, leaving a documented DNS-rebinding time-of-check/time-of-use gap. Browser Run interception reuses the same policy but likewise cannot pin Chromium's later socket to the checked answer. Redirect and request revalidation are defense in depth, not a perfect rebinding guarantee.

## Certificate mechanisms

The first mechanism is an independent `node:tls` client attempt. It is restricted to a prevalidated public address, port 443, and SNI equal to the normalized requested hostname. There is no route or tool that accepts a user-selected TCP port. When the runtime exposes a peer certificate, Packet Journey normalizes subject, DNS SANs, issuer, serial, SHA-256 fingerprint, validity dates, bounded chain metadata, and public-key properties where available.

Workers socket policy can reject port-443 peer probing even when normal HTTP `fetch` succeeds; this is observed in local Wrangler. When that happens, Packet Journey calls the fixed SSLMate Cert Spotter CT Search API. Only the normalized hostname is sent. The URL path/query, target headers/body, resolved address, cookies, and user identity are not sent. Responses are limited to 256 KiB, validated, and SAN-limited.

The CT fallback is explicitly modeled as `certificate-transparency`. It shows an issuance recorded in monitored CT logs; it does not prove the website currently serves that certificate. CT evidence therefore produces an informational issuance finding, not high-severity expired or hostname-mismatch conclusions about the target connection. An optional `CERTSPOTTER_API_TOKEN` supports production-volume lookup and must be stored as a Wrangler secret. If both mechanisms fail, the TLS stage stays a warning and the successful HTTP journey remains intact.

## Hostname matching

Coverage is deterministic and IDN-normalized:

- An exact DNS SAN matches case-insensitively after ASCII normalization.
- `*.example.com` matches one label such as `app.example.com`.
- That wildcard does not match `example.com` or `a.b.example.com`.
- DNS SANs take precedence. The legacy subject common name is considered only when no DNS SAN exists.
- SAN output is capped at 100 unique values.

Validity is evaluated against the collection timestamp. Expired, not-yet-valid, and served-peer hostname mismatch findings are high severity. Expiration within 14 days is medium; 15–30 days is low. Probe unavailability is informational because it does not establish certificate invalidity. Issuer identity is evidence, never a reputation judgment.

## Redirect and host selection

One investigation considers at most three hostname/protocol boundaries and three certificate mechanisms. It prioritizes the initial host, final host, and meaningful domain transitions. An HTTP→HTTPS redirect on the same hostname reuses DNS evidence and inserts TLS after the redirect. Apex→`www` and cross-domain transitions receive distinct DNS/TLS stages. Identical hostname evidence is not duplicated.

## Timing and unsupported fields

DNS duration measures the DoH subrequests performed for one host. Certificate duration measures the independent peer/CT mechanism as a whole. Neither value is the DNS or TLS phase of Worker HTTP fetch.

Standard Worker fetch does not expose the target session's TLS protocol version, cipher suite, ALPN result, TCP duration, handshake duration, or selected peer chain. These fields remain the literal value `unavailable`. Incoming `request.cf` TLS metadata describes the user→Cloudflare connection and is never substituted.

## Partial results and presentation

A journey-critical DNS failure produces input → DNS error → terminal error and never shows TLS/HTTP success. A later unresolved redirect host preserves all earlier DNS, certificate, redirect, and HTTP evidence. Independent certificate failure is non-terminal when HTTP succeeds.

Beginner mode shows concise DNS/certificate summaries. Developer mode shows records, TTLs, aliases, SANs, issuer, validity, and coverage. Network Engineer mode also shows complete bounded record sets, resolver status/AD metadata, address-policy classification, certificate identifiers/chain data where available, exact sources, timestamps, and runtime limitations. All modes use the same canonical evidence.

## Testing

The main suite uses recorded DoH, certificate, CT, redirect, and HTTP fixtures. It covers record parsing, IDNs, duplicate/output limits, CNAME loops/depth, mixed blocked answers, DNSSEC signals, SAN wildcard semantics, validity states, malformed providers, host transitions, partial results, finding links, API envelopes, and expertise-mode depth. Public Internet checks are manual smoke tests only.
