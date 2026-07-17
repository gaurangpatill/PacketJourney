import type { AiExpertiseMode } from "../../features/investigation/aiSchema";
import type { Investigation } from "../../features/investigation/schema";
import {
  referenceFilterSchema,
  type ReferenceCategory,
  type ReferenceFilter,
} from "../../features/references/schema";
import { REFERENCE_CONFIG } from "../../features/references/config";

export interface ControlledReferenceQuery {
  sanitizedQuestion: string;
  query: string;
  filter: ReferenceFilter;
  terms: string[];
}

const categoryRules: Array<{ pattern: RegExp; categories: ReferenceCategory[] }> = [
  {
    pattern: /cache|cache-control|age|etag|revalidat|cdn|cf-cache-status/i,
    categories: ["caching", "http", "cdn"],
  },
  { pattern: /dnssec|authenticated data|\bad\b/i, categories: ["dnssec", "dns"] },
  { pattern: /dns|cname|resolver|aaaa?|ttl/i, categories: ["dns", "dnssec"] },
  {
    pattern: /certificate|hostname mismatch|issuer|san|expiry|expired/i,
    categories: ["certificates", "tls"],
  },
  {
    pattern: /tls|cipher|alpn|handshake/i,
    categories: ["tls", "certificates", "cloudflare-workers-runtime"],
  },
  { pattern: /redirect|location|301|302|303|307|308/i, categories: ["redirects", "http"] },
  {
    pattern: /security header|csp|hsts|frame|referrer|permissions/i,
    categories: ["security-headers", "http"],
  },
  {
    pattern: /javascript|script transfer|bundle/i,
    categories: ["performance", "third-party-resources", "resource-loading"],
  },
  {
    pattern: /render|stylesheet|javascript|resource|waterfall|first contentful|lcp/i,
    categories: ["browser-navigation", "resource-loading", "performance", "core-web-vitals"],
  },
  {
    pattern: /third.party|analytics|advertis|tag manager/i,
    categories: ["third-party-resources", "performance", "resource-loading"],
  },
  {
    pattern: /worker fetch|cloudflare worker|tls metadata|runtime limit/i,
    categories: ["cloudflare-workers-runtime"],
  },
  {
    pattern: /browser run|browser rendering|laboratory metric/i,
    categories: ["cloudflare-browser-run", "performance"],
  },
  { pattern: /\bd1\b|database limit|persistence/i, categories: ["cloudflare-d1"] },
  { pattern: /\br2\b|private artifact|object storage/i, categories: ["cloudflare-r2"] },
];

function sanitize(value: string): string {
  return value
    .replace(/https?:\/\/[^\s]+/gi, (raw) => {
      try {
        const url = new URL(raw);
        return `${url.protocol}//${url.hostname}/[path]`;
      } catch {
        return "[url]";
      }
    })
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function words(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [])]
    .filter(
      (word) => !["this", "that", "with", "from", "what", "why", "page", "website"].includes(word),
    )
    .slice(0, 24);
}

export function buildControlledReferenceQuery(input: {
  question: string;
  investigation: Investigation;
  expertiseMode: AiExpertiseMode;
}): ControlledReferenceQuery {
  const sanitizedQuestion = sanitize(input.question);
  const evidenceText = input.investigation.stages
    .flatMap((stage) =>
      stage.evidence.map((item) => `${item.label} ${String(item.value).slice(0, 100)}`),
    )
    .join(" ");
  const findingText = input.investigation.findings
    .map((finding) => `${finding.category} ${finding.title}`)
    .join(" ");
  const combined = `${sanitizedQuestion} ${findingText} ${evidenceText}`;
  const matched =
    categoryRules.find((rule) => rule.pattern.test(sanitizedQuestion)) ??
    categoryRules.find((rule) => rule.pattern.test(combined));
  const categories = (matched?.categories ?? ["http", "performance"]).slice(0, 6);
  const runtimeOnly = categories.length === 1 && categories[0]?.startsWith("cloudflare-");
  const terms = words(combined);
  const query = sanitize(
    `${sanitizedQuestion}. Technical semantics for ${categories.join(", ")}. ${terms.slice(0, 12).join(" ")}. Expertise: ${input.expertiseMode}`,
  ).slice(0, 1_200);
  return {
    sanitizedQuestion,
    query,
    filter: referenceFilterSchema.parse({
      categories,
      ...(runtimeOnly ? { publishers: ["cloudflare"] } : {}),
      corpusVersion: REFERENCE_CONFIG.corpusVersion,
      language: "en",
    }),
    terms,
  };
}
