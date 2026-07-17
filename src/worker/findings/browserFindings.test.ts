import { describe, expect, it } from "vitest";
import type { BrowserDiagnosticResult } from "../browser/types";
import { createBrowserFindings } from "./browserFindings";

function browser(overrides: Partial<BrowserDiagnosticResult> = {}): BrowserDiagnosticResult {
  return {
    status: "success",
    requestedUrl: "https://example.com/",
    finalUrl: "https://example.com/",
    redirectCount: 0,
    readiness: "loaded",
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
    navigation: {},
    resources: [],
    resourceSummary: {
      totalObserved: 0,
      retained: 0,
      truncated: false,
      firstPartyCount: 0,
      thirdPartyCount: 0,
      failedCount: 0,
      domains: 0,
    },
    console: [],
    consoleTruncated: false,
    blockedRequests: [],
    errors: [],
    limitations: [],
    startedAt: "2026-07-17T12:00:00.000Z",
    completedAt: "2026-07-17T12:00:01.000Z",
    durationMs: 1_000,
    ...overrides,
  };
}

function findings(result: BrowserDiagnosticResult) {
  return createBrowserFindings({
    browser: result,
    statusId: "status",
    navigationId: "navigation",
    resourceSummaryId: "summary",
    resourcesId: "resources",
    consoleId: "console",
    errorsId: "errors",
  });
}

describe("deterministic browser findings", () => {
  it("reports an unavailable binding without invalidating prior evidence", () => {
    expect(
      findings(
        browser({
          status: "unavailable",
          readiness: "unavailable",
          errors: [
            {
              code: "browser_binding_unavailable",
              message: "Browser unavailable.",
              retryable: false,
              phase: "binding",
            },
          ],
        }),
      ),
    ).toEqual([
      expect.objectContaining({
        id: "finding-browser-unavailable",
        severity: "info",
        evidenceIds: ["status", "errors"],
      }),
    ]);
  });

  it("flags bounded payload, third-party, failed-critical, FCP, and console rules", () => {
    const result = browser({
      navigation: { firstContentfulPaintMs: 3_000 },
      resourceSummary: {
        totalObserved: 25,
        retained: 25,
        truncated: false,
        firstPartyCount: 4,
        thirdPartyCount: 21,
        failedCount: 1,
        totalTransferBytes: 4_000_000,
        javascriptTransferBytes: 1_500_000,
        domains: 8,
      },
      resources: [
        {
          id: "stylesheet",
          url: "https://example.com/app.css",
          origin: "https://example.com",
          hostname: "example.com",
          type: "stylesheet",
          method: "GET",
          firstParty: true,
          classificationBasis: "fixture",
          failed: true,
          renderBlockingCandidate: true,
        },
      ],
      console: [
        ...Array.from({ length: 3 }, (_, index) => ({
          level: "error" as const,
          message: "error " + index,
          timestamp: "2026-07-17T12:00:00.000Z",
          origin: "page-console" as const,
          truncated: false,
        })),
      ],
    });
    const ids = findings(result).map((finding) => finding.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "finding-browser-large-transfer",
        "finding-browser-large-javascript",
        "finding-browser-many-third-parties",
        "finding-browser-failed-critical-resource",
        "finding-browser-slow-fcp",
        "finding-browser-console-errors",
      ]),
    );
    expect(findings(result).every((finding) => finding.evidenceIds.length > 0)).toBe(true);
    expect(
      findings(result)
        .map((finding) => finding.explanation)
        .join(" "),
    ).not.toContain("caused the page");
  });

  it("does not treat a failed optional image as a critical failure", () => {
    const result = browser({
      resources: [
        {
          id: "image",
          url: "https://example.com/optional.jpg",
          origin: "https://example.com",
          hostname: "example.com",
          type: "image",
          method: "GET",
          firstParty: true,
          classificationBasis: "fixture",
          failed: true,
          renderBlockingCandidate: false,
        },
      ],
    });
    expect(findings(result).map((finding) => finding.id)).not.toContain(
      "finding-browser-failed-critical-resource",
    );
  });
});
