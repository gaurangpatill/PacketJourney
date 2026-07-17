# Retrieval evaluation

The deterministic fixture suite covers private/no-store caching, Cloudflare cache status, CNAME complexity, DNSSEC AD limits, independent-certificate provenance, hostname mismatch, redirects, security headers, render-blocking stylesheets, JavaScript transfer, third parties, Worker TLS metadata limits, Browser Run lab limits, D1 limits, and private R2 artifacts.

Each case declares an expected category, preferred publisher set, required concepts, and forbidden overclaims. Tests check category-filter correctness, relevant-source presence, content concepts, duplicate rate, publisher diversity, stable ranking, score/budget limits, invalid-dimension failure, explicit binding unavailability, manifest safety, frozen-citation allowlisting, and invented citation rejection. Real embedding scores are intentionally not asserted exactly across model revisions.

The suite is a regression signal, not evidence that retrieval quality is complete. New corpus or algorithm versions require fixture review and a preview evaluation against the real model/index before activation. No-result correctness is preserved by the fixed similarity floor: production does not lower it or search the web when no allowlisted passage qualifies.

Run:

```bash
npm run test:retrieval
```
