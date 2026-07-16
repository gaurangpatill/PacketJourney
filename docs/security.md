# Security model

User-submitted URLs are hostile input. The future safe-fetch boundary will accept only HTTP and HTTPS, normalize hostnames, resolve DNS, reject non-public address ranges, pin or re-check resolved addresses at connection time, and repeat validation for every redirect.

The service will block loopback, private, carrier-grade NAT, link-local, unspecified, multicast, documentation/test ranges where appropriate, IPv4-mapped IPv6 bypasses, cloud metadata targets, internal-looking hostnames, credential-bearing URLs, excessive redirects, oversized bodies, and slow responses. Browser jobs receive equivalent navigation and subresource controls.

Additional controls include per-principal rate limits, maximum execution windows, bounded queue retries, output escaping, structured audit logs, least-privilege bindings, and artifact retention policies. Layer 1 performs client-side protocol validation for usability only; it is not presented as an SSRF security control.
