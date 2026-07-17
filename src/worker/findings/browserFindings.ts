import type { Finding } from "../../features/investigation/schema";
import type { BrowserDiagnosticResult } from "../browser/types";

export interface BrowserFindingEvidence {
  browser: BrowserDiagnosticResult;
  statusId: string;
  navigationId: string;
  resourceSummaryId: string;
  resourcesId: string;
  consoleId: string;
  errorsId: string;
  screenshotId?: string;
}

export function createBrowserFindings(input: BrowserFindingEvidence | undefined): Finding[] {
  if (!input) return [];
  const { browser } = input;
  const findings: Finding[] = [];
  const unavailable = browser.errors.find((error) => error.code === "browser_binding_unavailable");
  if (unavailable) {
    findings.push({
      id: "finding-browser-unavailable",
      severity: "info",
      category: "frontend",
      title: "Browser investigation unavailable",
      explanation: `${unavailable.message} DNS, TLS, redirect, and HTTP evidence remain valid.`,
      evidenceIds: [input.statusId, input.errorsId],
      confidence: 1,
    });
    return findings;
  }

  const timeout = browser.errors.find((error) => error.code === "browser_navigation_timeout");
  if (timeout) {
    findings.push({
      id: "finding-browser-timeout",
      severity: "medium",
      category: "frontend",
      title: "Browser navigation exceeded its load deadline",
      explanation:
        "The isolated lab browser did not reach the load event within the bounded navigation window. Partial resources may still be useful evidence.",
      evidenceIds: [input.statusId, input.errorsId],
      recommendation:
        "Review slow or failed resources and confirm whether the page intentionally keeps the load event open.",
      confidence: 1,
    });
  }

  if (browser.redirectCount >= 3) {
    findings.push({
      id: "finding-browser-redirect-chain",
      severity: "low",
      category: "redirect",
      title: "Browser observed multiple redirects",
      explanation: `The browser navigation traversed ${browser.redirectCount} redirects after the Worker had already selected its final URL. Browser and Worker behavior can differ because of user-agent or script-driven navigation.`,
      evidenceIds: [input.navigationId],
      recommendation:
        "Review whether browser-specific redirects are necessary for the initial page load.",
      confidence: 1,
    });
  }

  if (browser.finalUrl) {
    const requested = new URL(browser.requestedUrl);
    const final = new URL(browser.finalUrl);
    if (requested.hostname !== final.hostname) {
      findings.push({
        id: "finding-browser-cross-domain-navigation",
        severity: "low",
        category: "redirect",
        title: "Browser crossed a domain boundary",
        explanation: `The verified Worker final hostname was ${requested.hostname}, while the isolated browser finished at ${final.hostname}. Both destinations passed the browser public-network policy.`,
        evidenceIds: [input.navigationId],
        recommendation:
          "Confirm that the browser-specific cross-domain navigation is intentional and expected for unauthenticated visitors.",
        confidence: 1,
      });
    } else if (requested.toString() !== final.toString()) {
      findings.push({
        id: "finding-browser-url-difference",
        severity: "info",
        category: "redirect",
        title: "Browser final URL differs from Worker final URL",
        explanation:
          "The browser finished at a different same-host URL, which may reflect client-side routing or browser-specific redirect behavior.",
        evidenceIds: [input.navigationId],
        confidence: 0.9,
      });
    }
  }

  const totalBytes = browser.resourceSummary.totalTransferBytes;
  if (totalBytes !== undefined && totalBytes > 3_000_000) {
    findings.push({
      id: "finding-browser-large-transfer",
      severity: "medium",
      category: "frontend",
      title: "Large browser transfer observed",
      explanation: `The retained browser timing entries reported approximately ${Math.round(totalBytes / 1_000)} kB transferred in this lab session. Cross-origin timing restrictions may make this total incomplete.`,
      evidenceIds: [input.resourceSummaryId],
      recommendation: "Prioritize compression, caching, and removal of unnecessary page resources.",
      confidence: 0.9,
    });
  }

  const scriptBytes = browser.resourceSummary.javascriptTransferBytes;
  if (scriptBytes !== undefined && scriptBytes > 1_000_000) {
    findings.push({
      id: "finding-browser-large-javascript",
      severity: "medium",
      category: "frontend",
      title: "Large JavaScript transfer observed",
      explanation: `JavaScript resources reported approximately ${Math.round(scriptBytes / 1_000)} kB transferred in this browser session. Transfer size does not measure parse or execution cost.`,
      evidenceIds: [input.resourceSummaryId],
      recommendation: "Audit bundle splitting, unused code, compression, and deferred loading.",
      confidence: 0.9,
    });
  }

  if (browser.resourceSummary.thirdPartyCount >= 20) {
    findings.push({
      id: "finding-browser-many-third-parties",
      severity: "low",
      category: "third-party",
      title: "High third-party request count",
      explanation: `${browser.resourceSummary.thirdPartyCount} retained requests crossed the final document's registrable-domain boundary. Their purpose and impact vary.`,
      evidenceIds: [input.resourceSummaryId, input.resourcesId],
      recommendation: "Review whether each external dependency is necessary before first render.",
      confidence: 0.9,
    });
  }

  const failedCritical = browser.resources.filter(
    (resource) =>
      resource.failed &&
      (resource.type === "stylesheet" ||
        resource.type === "script" ||
        resource.type === "document"),
  );
  if (failedCritical.length > 0) {
    findings.push({
      id: "finding-browser-failed-critical-resource",
      severity: "medium",
      category: "frontend",
      title: "Critical resource request failed",
      explanation: `${failedCritical.length} document, stylesheet, or script request failed. This may affect rendering or behavior, but impact depends on how the page uses the resource.`,
      evidenceIds: [input.resourcesId],
      recommendation: "Inspect the failed URL and failure reason, then verify user-visible impact.",
      confidence: 0.85,
    });
  }

  const renderBlocking = browser.resources.filter((resource) => resource.renderBlockingCandidate);
  if (renderBlocking.length >= 3) {
    findings.push({
      id: "finding-browser-render-blocking-candidates",
      severity: "low",
      category: "frontend",
      title: "Early render-blocking candidates observed",
      explanation: `${renderBlocking.length} stylesheet or synchronous-script candidates were present in the document and loaded before rendering milestones. This evidence does not prove causation.`,
      evidenceIds: [input.resourcesId, input.navigationId],
      recommendation:
        "Evaluate critical CSS and defer non-essential scripts where behavior permits.",
      confidence: 0.75,
    });
  }

  const fcp = browser.navigation.firstContentfulPaintMs;
  if (fcp !== undefined && fcp > 2_500) {
    findings.push({
      id: "finding-browser-slow-fcp",
      severity: "medium",
      category: "frontend",
      title: "Slow First Contentful Paint in this lab session",
      explanation: `First Contentful Paint was observed at ${Math.round(fcp)} ms in one isolated Browser Run session. This is not a field performance score.`,
      evidenceIds: [input.navigationId],
      recommendation:
        "Review early network dependencies and validate with repeated lab and real-user measurements.",
      confidence: 1,
    });
  }

  const consoleErrors = browser.console.filter((entry) => entry.level === "error").length;
  if (consoleErrors >= 3) {
    findings.push({
      id: "finding-browser-console-errors",
      severity: "low",
      category: "frontend",
      title: "Multiple browser console errors observed",
      explanation: `${consoleErrors} bounded console error entries were captured. Console errors require application context before impact can be determined.`,
      evidenceIds: [input.consoleId],
      recommendation: "Reproduce and triage errors that affect critical page functionality.",
      confidence: 1,
    });
  }

  if (browser.artifact && browser.readiness !== "loaded") {
    findings.push({
      id: "finding-browser-partial-screenshot",
      severity: "info",
      category: "frontend",
      title: "Screenshot captured from a partial load",
      explanation:
        "The screenshot records the browser state after incomplete navigation and should not be treated as a fully loaded representation.",
      evidenceIds: [input.statusId, ...(input.screenshotId ? [input.screenshotId] : [])],
      confidence: 1,
    });
  }

  return findings;
}
