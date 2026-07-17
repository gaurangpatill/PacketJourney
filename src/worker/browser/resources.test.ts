import { describe, expect, it } from "vitest";
import { BROWSER_LIMITS } from "./limits";
import { selectBrowserResources, summarizeBrowserResources } from "./resources";
import type { BrowserResource } from "./types";

function resource(index: number, overrides: Partial<BrowserResource> = {}): BrowserResource {
  return {
    id: `resource-${index}`,
    url: `https://assets.example.com/${index}.js`,
    origin: "https://assets.example.com",
    hostname: "assets.example.com",
    type: "script",
    method: "GET",
    transferSize: 1_000,
    durationMs: index,
    firstParty: true,
    classificationBasis: "fixture",
    failed: false,
    renderBlockingCandidate: false,
    ...overrides,
  };
}

describe("browser resource aggregation", () => {
  it("retains a stable bounded view while aggregating the full bounded collection", () => {
    const resources = Array.from({ length: 200 }, (_, index) =>
      resource(index, { failed: index < 50 }),
    );
    const selected = selectBrowserResources(resources);
    const summary = summarizeBrowserResources(resources, 240, selected.length);

    expect(selected).toHaveLength(BROWSER_LIMITS.maximumResources);
    expect(selected.filter((item) => item.failed)).toHaveLength(
      BROWSER_LIMITS.maximumFailedRequests,
    );
    expect(summary).toMatchObject({
      totalObserved: 240,
      retained: 150,
      truncated: true,
      failedCount: 50,
      totalTransferBytes: 200_000,
      javascriptTransferBytes: 200_000,
      domains: 1,
    });
    expect(selectBrowserResources(resources).map((item) => item.id)).toEqual(
      selected.map((item) => item.id),
    );
  });

  it("caps unique domains and preserves duplicate URL requests as separate observations", () => {
    const resources = Array.from({ length: 45 }, (_, index) =>
      resource(index, {
        hostname: `cdn-${index}.example`,
        origin: `https://cdn-${index}.example`,
        url: index < 2 ? "https://duplicate.example/app.js" : `https://cdn-${index}.example/app.js`,
        failed: index < 2,
      }),
    );
    const selected = selectBrowserResources(resources);

    expect(new Set(selected.map((item) => item.hostname)).size).toBe(BROWSER_LIMITS.maximumDomains);
    expect(selected.filter((item) => item.url.includes("duplicate.example"))).toHaveLength(2);
  });
});
