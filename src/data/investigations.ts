import {
  investigationSchema,
  type Investigation,
  type JourneyStage,
} from "../features/investigation/schema";

const collectedAt = "2026-07-16T04:15:12.000Z";

type StageOptions = {
  id: string;
  type: JourneyStage["type"];
  title: string;
  shortTitle?: string;
  description: string;
  duration?: number;
  status?: JourneyStage["status"];
  next?: string[];
  branch?: number;
  evidence?: Array<{
    label: string;
    value: unknown;
    source?: string;
    confidence?: "verified" | "inferred";
  }>;
};

function stage(options: StageOptions): JourneyStage {
  return {
    id: options.id,
    type: options.type,
    title: options.title,
    shortTitle: options.shortTitle ?? options.title,
    description: options.description,
    status: options.status ?? "success",
    startedAt: collectedAt,
    completedAt: collectedAt,
    durationMs: options.duration,
    connections: options.next ?? [],
    branch: options.branch ?? 0,
    evidence: (options.evidence ?? []).map((item, index) => ({
      id: `${options.id}-e${index + 1}`,
      label: item.label,
      value: item.value,
      source: item.source ?? "Recorded diagnostic fixture",
      collectedAt,
      confidence: item.confidence ?? "verified",
    })),
  };
}

const base = {
  status: "completed" as const,
  createdAt: collectedAt,
  completedAt: "2026-07-16T04:15:14.120Z",
  artifacts: [],
  mock: true,
};

const cached = investigationSchema.parse({
  ...base,
  id: "fast-cached",
  title: "Fast edge-cached response",
  summary:
    "A short path with an edge cache hit. The origin is not contacted for the document request.",
  scenario: "fast-cached",
  url: "https://www.cloudflare.com/",
  normalizedUrl: "https://www.cloudflare.com/",
  stages: [
    stage({
      id: "input",
      type: "input",
      title: "Browser request",
      shortTitle: "Browser",
      description: "Navigation begins in the browser.",
      duration: 0,
      next: ["dns"],
      evidence: [{ label: "Request URL", value: "https://www.cloudflare.com/" }],
    }),
    stage({
      id: "dns",
      type: "dns",
      title: "DNS resolution",
      shortTitle: "DNS",
      description: "The hostname resolves to an edge network.",
      duration: 18,
      next: ["tls"],
      evidence: [
        { label: "Resolved address", value: "104.16.124.96" },
        { label: "Resolver", value: "1.1.1.1" },
      ],
    }),
    stage({
      id: "tls",
      type: "tls",
      title: "Secure connection",
      shortTitle: "TLS",
      description: "An encrypted HTTP/2 connection is negotiated.",
      duration: 42,
      next: ["edge"],
      evidence: [
        { label: "Protocol", value: "TLS 1.3" },
        { label: "ALPN", value: "h2" },
      ],
    }),
    stage({
      id: "edge",
      type: "edge",
      title: "Cloudflare edge",
      shortTitle: "Edge",
      description: "The request reaches the nearest edge location.",
      duration: 8,
      next: ["cache"],
      evidence: [
        { label: "Colo", value: "EWR" },
        { label: "Server", value: "cloudflare" },
      ],
    }),
    stage({
      id: "cache",
      type: "cache",
      title: "Cache hit",
      shortTitle: "Cache",
      description: "Fresh HTML is served directly from edge cache.",
      duration: 11,
      next: ["browser"],
      evidence: [
        { label: "CF-Cache-Status", value: "HIT" },
        { label: "Age", value: "124 seconds" },
      ],
    }),
    stage({
      id: "browser",
      type: "browser",
      title: "Browser render",
      shortTitle: "Render",
      description: "The browser parses the response and paints content.",
      duration: 164,
      evidence: [
        { label: "First contentful paint", value: "243 ms" },
        { label: "Resources", value: 18 },
      ],
    }),
  ],
  findings: [
    {
      id: "cached-f1",
      severity: "info",
      category: "cache",
      title: "Document served at the edge",
      explanation:
        "The recorded response reports an edge cache hit, avoiding an origin round trip.",
      evidenceIds: ["cache-e1", "cache-e2"],
      confidence: 1,
    },
  ],
  metrics: {
    totalDurationMs: 243,
    dnsMs: 18,
    tlsMs: 42,
    timeToFirstByteMs: 79,
    firstContentfulPaintMs: 243,
    transferredBytes: 84231,
    requestCount: 18,
    thirdPartyCount: 2,
  },
});

const redirects = investigationSchema.parse({
  ...base,
  id: "redirect-chain",
  title: "Multi-hop redirect chain",
  summary:
    "Three document navigations happen before useful HTML arrives, adding connection and waiting time.",
  scenario: "redirect-chain",
  url: "http://store.example.com/",
  normalizedUrl: "http://store.example.com/",
  stages: [
    stage({
      id: "input",
      type: "input",
      title: "Browser request",
      shortTitle: "Browser",
      description: "The initial navigation uses HTTP.",
      next: ["dns"],
      evidence: [{ label: "Request URL", value: "http://store.example.com/" }],
    }),
    stage({
      id: "dns",
      type: "dns",
      title: "DNS resolution",
      shortTitle: "DNS",
      description: "The storefront hostname resolves.",
      duration: 22,
      next: ["r1"],
      evidence: [{ label: "A record", value: "203.0.113.42" }],
    }),
    stage({
      id: "r1",
      type: "redirect",
      title: "HTTP to HTTPS",
      shortTitle: "301",
      description: "The server upgrades the request to HTTPS.",
      duration: 91,
      status: "warning",
      next: ["r2"],
      evidence: [
        { label: "Location", value: "https://store.example.com/" },
        { label: "Status", value: 301 },
      ],
    }),
    stage({
      id: "r2",
      type: "redirect",
      title: "Canonical host",
      shortTitle: "302",
      description: "Traffic moves to the canonical www hostname.",
      duration: 118,
      status: "warning",
      next: ["r3"],
      evidence: [
        { label: "Location", value: "https://www.example.com/shop" },
        { label: "Status", value: 302 },
      ],
    }),
    stage({
      id: "r3",
      type: "redirect",
      title: "Locale redirect",
      shortTitle: "302",
      description: "A locale path is selected before content loads.",
      duration: 104,
      status: "warning",
      next: ["origin"],
      evidence: [
        { label: "Location", value: "https://www.example.com/en-us/shop" },
        { label: "Status", value: 302 },
      ],
    }),
    stage({
      id: "origin",
      type: "origin",
      title: "Origin response",
      shortTitle: "Origin",
      description: "The final document is generated at origin.",
      duration: 286,
      next: ["browser"],
      evidence: [{ label: "Time to first byte", value: "286 ms" }],
    }),
    stage({
      id: "browser",
      type: "browser",
      title: "Browser render",
      shortTitle: "Render",
      description: "The final document becomes visible.",
      duration: 782,
      evidence: [{ label: "First contentful paint", value: "1.40 s" }],
    }),
  ],
  findings: [
    {
      id: "redirect-f1",
      severity: "medium",
      category: "redirect",
      title: "Three redirects delay the document",
      explanation:
        "The recorded chain completes three sequential redirects before the final response begins.",
      evidenceIds: ["r1-e1", "r2-e1", "r3-e1"],
      recommendation:
        "Link directly to the canonical HTTPS locale URL and consolidate server redirects.",
      confidence: 1,
    },
  ],
  metrics: {
    totalDurationMs: 1403,
    dnsMs: 22,
    tlsMs: 49,
    timeToFirstByteMs: 621,
    firstContentfulPaintMs: 1403,
    transferredBytes: 512044,
    requestCount: 46,
    thirdPartyCount: 8,
  },
});

const slowOrigin = investigationSchema.parse({
  ...base,
  id: "slow-origin",
  title: "Slow origin response",
  summary:
    "The request misses cache and waits at the application origin for most of the document response time.",
  scenario: "slow-origin",
  url: "https://catalog.example.net/",
  normalizedUrl: "https://catalog.example.net/",
  stages: [
    stage({
      id: "input",
      type: "input",
      title: "Browser request",
      shortTitle: "Browser",
      description: "A catalog navigation begins.",
      next: ["dns"],
      evidence: [{ label: "URL", value: "https://catalog.example.net/" }],
    }),
    stage({
      id: "dns",
      type: "dns",
      title: "DNS resolution",
      shortTitle: "DNS",
      description: "The hostname resolves normally.",
      duration: 24,
      next: ["tls"],
      evidence: [{ label: "Lookup", value: "24 ms" }],
    }),
    stage({
      id: "tls",
      type: "tls",
      title: "TLS negotiation",
      shortTitle: "TLS",
      description: "The secure connection is established.",
      duration: 51,
      next: ["edge"],
      evidence: [{ label: "Version", value: "TLS 1.3" }],
    }),
    stage({
      id: "edge",
      type: "edge",
      title: "CDN edge",
      shortTitle: "Edge",
      description: "The CDN accepts the request.",
      duration: 9,
      next: ["cache"],
      evidence: [{ label: "Provider clue", value: "Cloudflare", confidence: "inferred" }],
    }),
    stage({
      id: "cache",
      type: "cache",
      title: "Cache miss",
      shortTitle: "Miss",
      description: "No reusable HTML response is available.",
      duration: 7,
      status: "warning",
      next: ["origin"],
      evidence: [{ label: "CF-Cache-Status", value: "DYNAMIC" }],
    }),
    stage({
      id: "origin",
      type: "origin",
      title: "Application origin",
      shortTitle: "Origin",
      description: "The backend spends 1.46 seconds producing a response.",
      duration: 1462,
      status: "warning",
      next: ["browser"],
      evidence: [
        { label: "Origin wait", value: "1.46 s" },
        { label: "Server-Timing", value: "app;dur=1418" },
      ],
    }),
    stage({
      id: "browser",
      type: "browser",
      title: "Browser render",
      shortTitle: "Render",
      description: "Rendering proceeds after the delayed HTML arrives.",
      duration: 621,
      evidence: [{ label: "First contentful paint", value: "2.17 s" }],
    }),
  ],
  findings: [
    {
      id: "origin-f1",
      severity: "high",
      category: "origin",
      title: "Origin wait dominates response time",
      explanation:
        "The measured origin wait accounts for roughly two thirds of the time to first paint.",
      evidenceIds: ["origin-e1", "origin-e2"],
      recommendation: "Profile server-side request handling and evaluate safe HTML caching.",
      confidence: 0.96,
    },
  ],
  metrics: {
    totalDurationMs: 2174,
    dnsMs: 24,
    tlsMs: 51,
    timeToFirstByteMs: 1553,
    firstContentfulPaintMs: 2174,
    transferredBytes: 721344,
    requestCount: 57,
    thirdPartyCount: 6,
  },
});

const thirdParty = investigationSchema.parse({
  ...base,
  id: "third-party-heavy",
  title: "Third-party dominated page",
  summary:
    "The primary document is healthy, but analytics, advertising, chat, and tag-manager branches delay rendering.",
  scenario: "third-party-heavy",
  url: "https://news.example.org/",
  normalizedUrl: "https://news.example.org/",
  stages: [
    stage({
      id: "input",
      type: "input",
      title: "Browser request",
      shortTitle: "Browser",
      description: "The news page navigation begins.",
      next: ["dns"],
      evidence: [{ label: "URL", value: "https://news.example.org/" }],
    }),
    stage({
      id: "dns",
      type: "dns",
      title: "DNS resolution",
      shortTitle: "DNS",
      description: "The primary hostname resolves.",
      duration: 19,
      next: ["edge"],
      evidence: [{ label: "Lookup", value: "19 ms" }],
    }),
    stage({
      id: "edge",
      type: "edge",
      title: "Edge response",
      shortTitle: "Edge",
      description: "HTML arrives quickly from the edge.",
      duration: 86,
      next: ["browser"],
      evidence: [{ label: "TTFB", value: "105 ms" }],
    }),
    stage({
      id: "browser",
      type: "browser",
      title: "HTML parsing",
      shortTitle: "Parse",
      description: "The document discovers first- and third-party resources.",
      duration: 72,
      next: ["content", "analytics", "ads", "chat"],
      evidence: [{ label: "Requests", value: 128 }],
    }),
    stage({
      id: "content",
      type: "resource",
      title: "First-party assets",
      shortTitle: "Assets",
      description: "Core styles, scripts, and images load.",
      duration: 504,
      branch: 0,
      next: ["render"],
      evidence: [{ label: "Transfer", value: "864 KB" }],
    }),
    stage({
      id: "analytics",
      type: "third-party",
      title: "Analytics",
      shortTitle: "Analytics",
      description: "Analytics and tag manager scripts execute.",
      duration: 716,
      status: "warning",
      branch: 1,
      next: ["render"],
      evidence: [
        { label: "Domain", value: "analytics.example" },
        { label: "Classification", value: "Analytics", confidence: "inferred" },
      ],
    }),
    stage({
      id: "ads",
      type: "third-party",
      title: "Advertising",
      shortTitle: "Ads",
      description: "Advertising resources fan out to six domains.",
      duration: 1288,
      status: "warning",
      branch: 2,
      next: ["render"],
      evidence: [
        { label: "Requests", value: 41 },
        { label: "Domains", value: 6 },
      ],
    }),
    stage({
      id: "chat",
      type: "third-party",
      title: "Support widget",
      shortTitle: "Chat",
      description: "A customer-support widget loads asynchronously.",
      duration: 842,
      branch: 3,
      next: ["render"],
      evidence: [{ label: "Classification", value: "Customer support", confidence: "inferred" }],
    }),
    stage({
      id: "render",
      type: "browser",
      title: "Browser render",
      shortTitle: "Render",
      description: "The page reaches its first useful render.",
      duration: 218,
      evidence: [{ label: "First contentful paint", value: "1.68 s" }],
    }),
  ],
  findings: [
    {
      id: "third-f1",
      severity: "high",
      category: "third-party",
      title: "Third parties drive 58% of requests",
      explanation: "Recorded browser data attributes 74 of 128 requests to non-primary domains.",
      evidenceIds: ["browser-e1", "ads-e1", "ads-e2"],
      recommendation: "Defer non-essential tags and audit advertising fan-out before first render.",
      confidence: 0.93,
    },
  ],
  metrics: {
    totalDurationMs: 1682,
    dnsMs: 19,
    tlsMs: 38,
    timeToFirstByteMs: 105,
    firstContentfulPaintMs: 1682,
    transferredBytes: 2841000,
    requestCount: 128,
    thirdPartyCount: 74,
  },
});

const tlsWarning = investigationSchema.parse({
  ...base,
  id: "tls-warning",
  title: "TLS certificate warning",
  summary:
    "DNS succeeds, but the secure connection stops because the recorded certificate is expired.",
  scenario: "tls-warning",
  url: "https://expired.example.dev/",
  normalizedUrl: "https://expired.example.dev/",
  status: "failed",
  stages: [
    stage({
      id: "input",
      type: "input",
      title: "Browser request",
      shortTitle: "Browser",
      description: "A secure navigation begins.",
      next: ["dns"],
      evidence: [{ label: "URL", value: "https://expired.example.dev/" }],
    }),
    stage({
      id: "dns",
      type: "dns",
      title: "DNS resolution",
      shortTitle: "DNS",
      description: "The hostname resolves successfully.",
      duration: 31,
      next: ["tls"],
      evidence: [{ label: "A record", value: "198.51.100.27" }],
    }),
    stage({
      id: "tls",
      type: "tls",
      title: "TLS validation failed",
      shortTitle: "TLS error",
      description: "The certificate validity window ended before collection time.",
      duration: 47,
      status: "error",
      next: ["error"],
      evidence: [
        { label: "Not after", value: "2026-07-14T23:59:59Z" },
        { label: "Validation", value: "CERT_DATE_INVALID" },
      ],
    }),
    stage({
      id: "error",
      type: "error",
      title: "Navigation stopped",
      shortTitle: "Stopped",
      description: "No HTTP request or browser render was attempted.",
      status: "error",
      evidence: [{ label: "Failure stage", value: "TLS certificate validation" }],
    }),
  ],
  findings: [
    {
      id: "tls-f1",
      severity: "high",
      category: "tls",
      title: "Certificate is past its validity window",
      explanation:
        "The recorded certificate expiry precedes the collection time, so compliant clients stop before HTTP.",
      evidenceIds: ["tls-e1", "tls-e2"],
      recommendation:
        "Renew and deploy the certificate, then verify the complete chain from an external client.",
      confidence: 1,
    },
  ],
  metrics: { totalDurationMs: 78, dnsMs: 31, tlsMs: 47, requestCount: 0, thirdPartyCount: 0 },
});

const missingCache = investigationSchema.parse({
  ...base,
  id: "missing-cache",
  title: "Missing cache configuration",
  summary:
    "HTML reaches the origin for every request because no explicit reusable cache policy is present.",
  scenario: "missing-cache",
  url: "https://docs.example.io/guide",
  normalizedUrl: "https://docs.example.io/guide",
  stages: [
    stage({
      id: "input",
      type: "input",
      title: "Browser request",
      shortTitle: "Browser",
      description: "A documentation page is requested.",
      next: ["dns"],
      evidence: [{ label: "URL", value: "https://docs.example.io/guide" }],
    }),
    stage({
      id: "dns",
      type: "dns",
      title: "DNS resolution",
      shortTitle: "DNS",
      description: "The edge hostname resolves.",
      duration: 16,
      next: ["tls"],
      evidence: [{ label: "Lookup", value: "16 ms" }],
    }),
    stage({
      id: "tls",
      type: "tls",
      title: "TLS negotiation",
      shortTitle: "TLS",
      description: "The secure connection is established.",
      duration: 39,
      next: ["cache"],
      evidence: [{ label: "Version", value: "TLS 1.3" }],
    }),
    stage({
      id: "cache",
      type: "cache",
      title: "Not cacheable",
      shortTitle: "Bypass",
      description: "No Cache-Control policy is present for the HTML response.",
      duration: 6,
      status: "warning",
      next: ["origin"],
      evidence: [
        { label: "Cache-Control", value: "Not present" },
        { label: "CDN cache status", value: "BYPASS" },
      ],
    }),
    stage({
      id: "origin",
      type: "origin",
      title: "Origin response",
      shortTitle: "Origin",
      description: "The documentation origin builds the response.",
      duration: 338,
      status: "warning",
      next: ["browser"],
      evidence: [{ label: "TTFB", value: "338 ms" }],
    }),
    stage({
      id: "browser",
      type: "browser",
      title: "Browser render",
      shortTitle: "Render",
      description: "Static documentation content becomes visible.",
      duration: 447,
      evidence: [{ label: "FCP", value: "846 ms" }],
    }),
  ],
  findings: [
    {
      id: "cache-f1",
      severity: "medium",
      category: "cache",
      title: "HTML has no explicit cache policy",
      explanation:
        "The recorded document response has no Cache-Control header and reports a CDN bypass.",
      evidenceIds: ["cache-e1", "cache-e2"],
      recommendation:
        "Define a short shared cache lifetime with revalidation if the content is safe to cache.",
      confidence: 1,
    },
  ],
  metrics: {
    totalDurationMs: 846,
    dnsMs: 16,
    tlsMs: 39,
    timeToFirstByteMs: 399,
    firstContentfulPaintMs: 846,
    transferredBytes: 394180,
    requestCount: 31,
    thirdPartyCount: 3,
  },
});

const simulation = investigationSchema.parse({
  ...cached,
  id: "edge-cache-simulation",
  title: "Simulated edge-cache improvement",
  summary: "A preview dataset comparing a measured cache miss with deterministic edge-cache rules.",
  scenario: "edge-cache-simulation",
});

export const investigations = [
  cached,
  redirects,
  slowOrigin,
  thirdParty,
  tlsWarning,
  missingCache,
  simulation,
] satisfies Investigation[];

export const investigationById = new Map(investigations.map((item) => [item.id, item]));

export const featuredInvestigation = slowOrigin;

export function investigationForUrl(url: string): Investigation {
  return investigationSchema.parse({
    ...featuredInvestigation,
    id: "url-preview",
    title: "Investigation preview",
    url,
    normalizedUrl: url,
    summary:
      "Layer 1 uses a clearly labeled seeded diagnostic shape while live network collection is being built.",
    stages: featuredInvestigation.stages.map((item) =>
      item.id === "input"
        ? {
            ...item,
            evidence: item.evidence.map((evidence, index) =>
              index === 0 ? { ...evidence, value: url } : evidence,
            ),
          }
        : item,
    ),
  });
}
