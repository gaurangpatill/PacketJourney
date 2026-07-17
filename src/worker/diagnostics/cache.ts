import type { AllowedHeaders } from "./types";

export type CacheDisposition =
  | "explicitly-cacheable"
  | "explicitly-non-cacheable"
  | "private"
  | "no-store"
  | "no-cache"
  | "missing-directives"
  | "ambiguous";

export type EdgeCacheEvidence = "hit" | "miss" | "bypass" | "unknown";

export interface CacheAnalysis {
  disposition: CacheDisposition;
  edgeEvidence: EdgeCacheEvidence;
  directives: Record<string, string | true>;
  hasRevalidationValidator: boolean;
  conflictingEvidence: boolean;
  reasons: string[];
}

function parseCacheControl(value: string | undefined): Record<string, string | true> {
  if (!value) return {};
  const directives: Record<string, string | true> = {};
  for (const part of value.split(",")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    const name = rawName?.toLowerCase();
    if (!name) continue;
    const joined = rawValue.join("=").trim().replace(/^"|"$/g, "");
    directives[name] = joined || true;
  }
  return directives;
}

function edgeCacheEvidence(headers: AllowedHeaders): EdgeCacheEvidence {
  const status = headers["cf-cache-status"]?.toUpperCase();
  if (status && ["HIT", "REVALIDATED", "UPDATING", "STALE"].includes(status)) return "hit";
  if (status && ["MISS", "EXPIRED"].includes(status)) return "miss";
  if (status && ["BYPASS", "DYNAMIC"].includes(status)) return "bypass";

  const age = Number.parseInt(headers.age ?? "0", 10);
  return Number.isFinite(age) && age > 0 ? "hit" : "unknown";
}

export function analyzeCacheHeaders(
  headers: AllowedHeaders,
  now: Date = new Date(),
): CacheAnalysis {
  const directives = parseCacheControl(headers["cache-control"]);
  const hasPublic = directives.public === true || "s-maxage" in directives;
  const hasPrivate = directives.private === true;
  const hasNoStore = directives["no-store"] === true;
  const hasNoCache = directives["no-cache"] === true;
  const hasFreshness = "max-age" in directives || "s-maxage" in directives;
  const hasValidator = Boolean(headers.etag || headers["last-modified"]);
  const edgeEvidence = edgeCacheEvidence(headers);
  const conflicts =
    (hasPublic && (hasPrivate || hasNoStore)) ||
    (edgeEvidence === "hit" && hasNoStore) ||
    (hasPrivate && edgeEvidence === "hit");
  const reasons: string[] = [];

  let disposition: CacheDisposition;
  if (hasNoStore) {
    disposition = "no-store";
    reasons.push("Cache-Control contains no-store, which forbids storage.");
  } else if (hasPrivate) {
    disposition = "private";
    reasons.push("Cache-Control marks the response private to a user agent cache.");
  } else if (hasNoCache) {
    disposition = "no-cache";
    reasons.push("Cache-Control requires successful revalidation before reuse.");
  } else if (hasFreshness || hasPublic) {
    disposition = "explicitly-cacheable";
    reasons.push("Cache-Control explicitly permits caching or supplies a freshness lifetime.");
  } else if (headers["cache-control"]) {
    disposition = "ambiguous";
    reasons.push("Cache-Control is present but does not establish clear shared-cache behavior.");
  } else if (headers.expires) {
    const expiresAt = Date.parse(headers.expires);
    if (Number.isNaN(expiresAt)) {
      disposition = "ambiguous";
      reasons.push("Expires is present but could not be interpreted as a valid date.");
    } else if (expiresAt > now.getTime()) {
      disposition = "explicitly-cacheable";
      reasons.push("Expires supplies a future freshness deadline.");
    } else {
      disposition = "explicitly-non-cacheable";
      reasons.push("Expires does not provide a future freshness lifetime.");
    }
  } else {
    disposition = "missing-directives";
    reasons.push("No Cache-Control or Expires policy was observed.");
  }

  if (edgeEvidence === "hit") reasons.push("Response headers contain cache-hit evidence.");
  if (edgeEvidence === "miss") reasons.push("Response headers contain cache-miss evidence.");
  if (edgeEvidence === "bypass") reasons.push("Response headers indicate cache bypass behavior.");
  if (hasValidator) reasons.push("ETag or Last-Modified can support conditional revalidation.");
  if (conflicts)
    reasons.push("The observed cache signals conflict and require cautious interpretation.");

  return {
    disposition,
    edgeEvidence,
    directives,
    hasRevalidationValidator: hasValidator,
    conflictingEvidence: conflicts,
    reasons,
  };
}
