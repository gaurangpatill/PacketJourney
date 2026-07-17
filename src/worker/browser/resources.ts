import { BROWSER_LIMITS } from "./limits";
import type { BrowserResource, BrowserResourceSummary } from "./types";

export function summarizeBrowserResources(
  resources: BrowserResource[],
  totalObserved: number,
  retained: number,
): BrowserResourceSummary {
  const sum = (predicate: (resource: BrowserResource) => boolean) => {
    const selected = resources.filter(predicate);
    return selected.some((resource) => resource.transferSize !== undefined)
      ? selected.reduce((total, resource) => total + (resource.transferSize ?? 0), 0)
      : undefined;
  };

  return {
    totalObserved,
    retained,
    truncated: totalObserved > retained,
    firstPartyCount: resources.filter((resource) => resource.firstParty).length,
    thirdPartyCount: resources.filter((resource) => !resource.firstParty).length,
    failedCount: resources.filter((resource) => resource.failed).length,
    totalTransferBytes: sum(() => true),
    javascriptTransferBytes: sum((resource) => resource.type === "script"),
    stylesheetTransferBytes: sum((resource) => resource.type === "stylesheet"),
    imageTransferBytes: sum((resource) => resource.type === "image"),
    thirdPartyTransferBytes: sum((resource) => !resource.firstParty),
    domains: new Set(resources.map((resource) => resource.hostname)).size,
  };
}

export function selectBrowserResources(resources: BrowserResource[]): BrowserResource[] {
  const ranked = [...resources].sort((left, right) => {
    const leftPriority = left.failed ? 0 : left.renderBlockingCandidate ? 1 : 2;
    const rightPriority = right.failed ? 0 : right.renderBlockingCandidate ? 1 : 2;
    return (
      leftPriority - rightPriority ||
      (right.durationMs ?? 0) - (left.durationMs ?? 0) ||
      left.url.localeCompare(right.url)
    );
  });
  const domains = new Set<string>();
  const retained: BrowserResource[] = [];
  let failedRetained = 0;

  for (const resource of ranked) {
    if (
      retained.length >= BROWSER_LIMITS.maximumResources ||
      (resource.failed && failedRetained >= BROWSER_LIMITS.maximumFailedRequests) ||
      (!domains.has(resource.hostname) && domains.size >= BROWSER_LIMITS.maximumDomains)
    ) {
      continue;
    }
    domains.add(resource.hostname);
    retained.push(resource);
    if (resource.failed) failedRetained += 1;
  }

  return retained;
}
