// @vitest-environment node
import { describe, expect, it } from "vitest";
import { analyzeCacheHeaders } from "./cache";

describe("cache header analysis", () => {
  it.each([
    [{ "cache-control": "public, max-age=300" }, "explicitly-cacheable"],
    [{ "cache-control": "private, max-age=60" }, "private"],
    [{ "cache-control": "no-store" }, "no-store"],
    [{ "cache-control": "no-cache", etag: '"abc"' }, "no-cache"],
    [{}, "missing-directives"],
  ] as const)("classifies %o as %s", (headers, disposition) => {
    expect(analyzeCacheHeaders(headers).disposition).toBe(disposition);
  });

  it("recognizes Cloudflare hit and miss evidence without inventing it", () => {
    expect(analyzeCacheHeaders({ "cf-cache-status": "HIT" }).edgeEvidence).toBe("hit");
    expect(analyzeCacheHeaders({ "cf-cache-status": "MISS" }).edgeEvidence).toBe("miss");
    expect(analyzeCacheHeaders({}).edgeEvidence).toBe("unknown");
  });

  it("recognizes generic Age hit evidence and revalidation validators", () => {
    const result = analyzeCacheHeaders({
      age: "42",
      "last-modified": "Wed, 01 Jan 2025 00:00:00 GMT",
    });
    expect(result.edgeEvidence).toBe("hit");
    expect(result.hasRevalidationValidator).toBe(true);
  });

  it("uses a future Expires header as explicit freshness evidence", () => {
    const result = analyzeCacheHeaders(
      { expires: "Wed, 01 Jan 2031 00:00:00 GMT" },
      new Date("2030-01-01T00:00:00Z"),
    );
    expect(result.disposition).toBe("explicitly-cacheable");
  });

  it("marks conflicting directives and cache-hit evidence", () => {
    const result = analyzeCacheHeaders({
      "cache-control": "public, no-store",
      "cf-cache-status": "HIT",
    });
    expect(result.disposition).toBe("no-store");
    expect(result.conflictingEvidence).toBe(true);
  });
});
