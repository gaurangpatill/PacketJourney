import type { ReferenceChunk } from "../features/references/schema";
import { buildReferenceChunks } from "./chunking";
import { referenceManifestById } from "./manifest";

const FIXTURE_RETRIEVED_AT = "2026-07-01T00:00:00.000Z";

const passages: Array<[string, string, string]> = [
  [
    "ietf-rfc9111-http-caching",
    "Cache-Control storage rules",
    "The private response directive indicates that a shared cache must not store the response. The no-store directive prohibits caches from storing any part of the response. no-cache permits storage but requires successful validation before reuse.",
  ],
  [
    "cloudflare-cache-status",
    "Cloudflare cache status",
    "CF-Cache-Status HIT indicates a response was served from Cloudflare cache. DYNAMIC indicates Cloudflare did not consider the asset eligible to cache, while MISS means the resource was not found in cache and was fetched from origin.",
  ],
  [
    "ietf-rfc1034-dns-concepts",
    "Canonical names and aliases",
    "A domain name identified as an alias points through a CNAME record to its canonical name. Long alias chains increase operational dependencies, but a DNS response alone does not establish measured latency or provider ownership.",
  ],
  [
    "ietf-rfc4035-dnssec",
    "Authenticated Data signal",
    "A validating security-aware resolver may set the Authenticated Data bit when it considers the answer authentic. That resolver-reported signal does not by itself prove every part of a domain's DNSSEC deployment is secure.",
  ],
  [
    "ietf-rfc5280-certificates",
    "Certificate identity and validity",
    "Certificate validity is bounded by notBefore and notAfter. Identity matching compares the requested hostname with permitted certificate names; a wildcard covers one label and does not match multiple nested labels.",
  ],
  [
    "ietf-rfc9110-http-semantics",
    "Redirect semantics",
    "Redirect status codes communicate a target URI in Location. Permanent and temporary redirects have different semantics, and 307 or 308 preserve the request method when automatically redirected.",
  ],
  [
    "owasp-secure-headers",
    "Browser security hardening",
    "Security response headers are defense-in-depth controls. Missing headers can be hardening opportunities but their absence alone is not proof that an application is exploitable.",
  ],
  [
    "mdn-csp",
    "Content Security Policy",
    "Content-Security-Policy controls allowed resource origins and other browser behavior. The frame-ancestors directive restricts which parents may embed a page and can provide frame protection.",
  ],
  [
    "web-dev-render-blocking",
    "Critical rendering path",
    "A stylesheet can block rendering while the browser constructs the CSS object model. Whether it delayed a particular page requires resource timing and render observations from that page.",
  ],
  [
    "mdn-resource-timing",
    "Resource timing visibility",
    "PerformanceResourceTiming exposes resource fetch timing and size attributes. Cross-origin resource details can be restricted unless the response opts in through Timing-Allow-Origin.",
  ],
  [
    "web-dev-third-party",
    "Third-party JavaScript",
    "Third-party scripts can add network transfer and main-thread work. Their impact varies by loading strategy and must be established using measurements rather than domain classification alone.",
  ],
  [
    "cloudflare-workers-fetch",
    "Workers fetch observability",
    "Workers fetch exposes the standard Fetch API response. It does not expose separate DNS, TCP, TLS-handshake, cipher-suite, or ALPN timing fields for the outbound request.",
  ],
  [
    "cloudflare-browser-run",
    "Browser Rendering measurements",
    "Browser Rendering provides an isolated browser session for page automation. Its performance observations are laboratory measurements from one bounded run, not field-user distributions.",
  ],
  [
    "cloudflare-d1-limits",
    "D1 operational limits",
    "D1 applies documented database, query, and row limits. Applications should bound statement batches and stored values and preserve schema migrations independently from application model versions.",
  ],
  [
    "cloudflare-r2-workers-api",
    "Private R2 artifacts",
    "An R2 bucket binding lets a Worker read and write objects without making the bucket public. A controlled Worker route can authorize access to private artifacts.",
  ],
  [
    "cloudflare-vectorize-metadata",
    "Vector metadata filters",
    "Vectorize supports metadata filtering over metadata indexes created for selected properties. Applications should define indexed fields before vector insertion and keep query filters deterministic.",
  ],
];

let cached: Promise<ReferenceChunk[]> | undefined;

export function fixtureReferenceCorpus(): Promise<ReferenceChunk[]> {
  cached ??= Promise.all(
    passages.map(async ([sourceId, heading, content]) => {
      const source = referenceManifestById.get(sourceId);
      if (!source) throw new Error(`Unknown fixture source: ${sourceId}`);
      const [chunk] = await buildReferenceChunks({
        source,
        sections: [{ heading, sectionPath: [heading], content }],
        retrievedAt: FIXTURE_RETRIEVED_AT,
      });
      if (!chunk) throw new Error(`Empty fixture source: ${sourceId}`);
      return chunk;
    }),
  );
  return cached;
}
