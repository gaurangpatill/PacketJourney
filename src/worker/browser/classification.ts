import { getDomain } from "tldts";
import type { BrowserResourceType, ThirdPartyCategory } from "./types";

const CATEGORY_RULES: ReadonlyArray<{
  category: Exclude<ThirdPartyCategory, "unknown">;
  patterns: RegExp[];
}> = [
  {
    category: "analytics",
    patterns: [/google-analytics\.com$/i, /analytics\.google\.com$/i, /plausible\.io$/i],
  },
  {
    category: "advertising",
    patterns: [/doubleclick\.net$/i, /googlesyndication\.com$/i, /adservice\.google\./i],
  },
  {
    category: "authentication",
    patterns: [/auth0\.com$/i, /okta\.com$/i, /accounts\.google\.com$/i],
  },
  {
    category: "payments",
    patterns: [/stripe\.com$/i, /paypal\.com$/i, /braintreegateway\.com$/i],
  },
  {
    category: "error-monitoring",
    patterns: [/sentry\.io$/i, /bugsnag\.com$/i, /rollbar\.com$/i],
  },
  {
    category: "customer-support",
    patterns: [/intercom\.io$/i, /intercomcdn\.com$/i, /zendesk\.com$/i],
  },
  {
    category: "tag-management",
    patterns: [/googletagmanager\.com$/i, /segment\.com$/i],
  },
  {
    category: "fonts",
    patterns: [/fonts\.googleapis\.com$/i, /fonts\.gstatic\.com$/i, /use\.typekit\.net$/i],
  },
  {
    category: "media",
    patterns: [/youtube\.com$/i, /ytimg\.com$/i, /vimeo\.com$/i],
  },
  {
    category: "cdn",
    patterns: [/cdn\.jsdelivr\.net$/i, /cdnjs\.cloudflare\.com$/i, /unpkg\.com$/i],
  },
];

export function registrableDomain(hostname: string): string {
  return getDomain(hostname, { allowPrivateDomains: false }) ?? hostname.toLowerCase();
}

export function classifyParty(
  resourceHostname: string,
  documentHostname: string,
): { firstParty: boolean; basis: string } {
  const resourceDomain = registrableDomain(resourceHostname);
  const documentDomain = registrableDomain(documentHostname);
  const firstParty = resourceDomain === documentDomain;
  return {
    firstParty,
    basis: `Registrable-domain comparison: ${resourceDomain} ${firstParty ? "=" : "≠"} ${documentDomain}`,
  };
}

export function classifyThirdParty(
  hostname: string,
  type: BrowserResourceType,
): ThirdPartyCategory {
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(hostname))) return rule.category;
  }
  if (type === "font") return "fonts";
  if (type === "media") return "media";
  return "unknown";
}

export function normalizeResourceType(type: string): BrowserResourceType {
  const normalized = type.toLowerCase();
  if (normalized === "document") return "document";
  if (normalized === "script") return "script";
  if (normalized === "stylesheet") return "stylesheet";
  if (normalized === "image") return "image";
  if (normalized === "font") return "font";
  if (normalized === "fetch") return "fetch";
  if (normalized === "xhr") return "xhr";
  if (normalized === "media") return "media";
  if (normalized === "websocket") return "websocket";
  if (normalized === "preflight") return "preflight";
  if (normalized === "iframe" || normalized === "subdocument") return "iframe";
  return "other";
}
