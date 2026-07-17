// @vitest-environment node
import { describe, expect, it } from "vitest";
import { investigationSchema } from "../../features/investigation/schema";
import type { HttpDiagnosticResult } from "../diagnostics/types";
import { adaptHttpDiagnosticToInvestigation } from "./investigation";

const startedAt = "2026-07-16T20:00:00.000Z";
const completedAt = "2026-07-16T20:00:00.120Z";

function diagnostic(overrides: Partial<HttpDiagnosticResult> = {}): HttpDiagnosticResult {
  return {
    requestedUrl: "example.com",
    normalizedUrl: {
      canonicalUrl: "https://example.com/",
      displayUrl: "https://example.com/",
      hostname: "example.com",
      protocol: "https:",
    },
    redirects: [],
    finalResponse: {
      url: "https://example.com/",
      status: 200,
      statusText: "OK",
      durationMs: 80,
      headers: {
        "content-type": "text/html",
        "cache-control": "public, max-age=300",
        "strict-transport-security": "max-age=31536000",
      },
      headersTruncated: false,
      collectedAt: completedAt,
    },
    startedAt,
    completedAt,
    totalDurationMs: 120,
    ...overrides,
  };
}

describe("HTTP diagnostic investigation adapter", () => {
  it("creates a runtime-valid simple final-response journey", () => {
    const investigation = adaptHttpDiagnosticToInvestigation(diagnostic(), { id: "live-simple" });

    expect(investigationSchema.safeParse(investigation).success).toBe(true);
    expect(investigation).toMatchObject({
      id: "live-simple",
      scenario: "live-http",
      mock: false,
      status: "completed",
      normalizedUrl: "https://example.com/",
    });
    expect(investigation.stages.map((stage) => stage.id)).toEqual([
      "input",
      "http-response",
      "cache-analysis",
      "document-received",
    ]);
    expect(investigation.metrics).not.toHaveProperty("dnsMs");
    expect(investigation.metrics).not.toHaveProperty("tlsMs");
    expect(investigation.metrics).not.toHaveProperty("timeToFirstByteMs");
  });

  it("renders each redirect as its own evidence-linked stage", () => {
    const base = diagnostic();
    const investigation = adaptHttpDiagnosticToInvestigation(
      diagnostic({
        redirects: [
          {
            index: 0,
            sourceUrl: "https://example.com/",
            status: 301,
            statusText: "Moved Permanently",
            location: "/middle",
            destinationUrl: "https://example.com/middle",
            destinationValidation: "passed",
            durationMs: 20,
            headers: { location: "/middle" },
            headersTruncated: false,
            collectedAt: startedAt,
          },
          {
            index: 1,
            sourceUrl: "https://example.com/middle",
            status: 308,
            statusText: "Permanent Redirect",
            location: "/final",
            destinationUrl: "https://example.com/final",
            destinationValidation: "passed",
            durationMs: 22,
            headers: { location: "/final" },
            headersTruncated: false,
            collectedAt: startedAt,
          },
        ],
        finalResponse: base.finalResponse
          ? { ...base.finalResponse, url: "https://example.com/final" }
          : undefined,
      }),
      { id: "live-redirects" },
    );

    expect(investigation.stages.filter((stage) => stage.type === "redirect")).toHaveLength(2);
    expect(investigation.findings).toContainEqual(
      expect.objectContaining({
        id: "finding-redirect-chain",
        evidenceIds: ["redirect-1-status", "redirect-2-status"],
      }),
    );
  });

  it("preserves partial progress and terminates on timeout", () => {
    const result = diagnostic({
      finalResponse: undefined,
      error: {
        code: "request_timeout",
        message: "The remote server timed out.",
        stage: "http",
        retryable: true,
      },
    });
    const investigation = adaptHttpDiagnosticToInvestigation(result, { id: "live-timeout" });

    expect(investigation.status).toBe("failed");
    expect(investigation.stages.at(-1)).toMatchObject({
      id: "terminal-error",
      type: "error",
      status: "error",
    });
    expect(investigation.stages.some((stage) => stage.type === "browser")).toBe(false);
  });

  it("keeps a blocked redirect hop and terminal policy error", () => {
    const result = diagnostic({
      redirects: [
        {
          index: 0,
          sourceUrl: "https://example.com/",
          status: 302,
          statusText: "Found",
          location: "http://127.0.0.1/admin",
          destinationUrl: "http://127.0.0.1/admin",
          destinationValidation: "blocked",
          durationMs: 12,
          headers: { location: "http://127.0.0.1/admin" },
          headersTruncated: false,
          collectedAt: completedAt,
        },
      ],
      finalResponse: undefined,
      error: {
        code: "blocked_redirect_destination",
        message: "The redirect entered a blocked network.",
        stage: "redirect",
        retryable: false,
      },
    });
    const investigation = adaptHttpDiagnosticToInvestigation(result, { id: "live-blocked" });

    expect(investigation.stages.map((stage) => stage.id)).toEqual([
      "input",
      "redirect-1",
      "terminal-error",
    ]);
    expect(investigation.stages[1]?.status).toBe("error");
  });

  it("uses an edge response stage only when response evidence supports it", () => {
    const cloudflare = diagnostic({
      finalResponse: {
        ...diagnostic().finalResponse!,
        headers: { "cf-ray": "abc-IAD", "cf-cache-status": "HIT" },
      },
    });
    const plain = diagnostic({
      finalResponse: {
        ...diagnostic().finalResponse!,
        headers: { server: "cloudflare", "cache-control": "public, max-age=60" },
      },
    });

    expect(
      adaptHttpDiagnosticToInvestigation(cloudflare, { id: "live-hit" }).stages.find(
        (stage) => stage.id === "http-response",
      )?.type,
    ).toBe("edge");
    expect(
      adaptHttpDiagnosticToInvestigation(plain, { id: "live-plain" }).stages.find(
        (stage) => stage.id === "http-response",
      )?.type,
    ).toBe("origin");
  });

  it("associates an ambiguous cache warning with cache evidence", () => {
    const result = diagnostic({
      finalResponse: {
        ...diagnostic().finalResponse!,
        headers: { "cache-control": "must-revalidate" },
      },
    });
    const investigation = adaptHttpDiagnosticToInvestigation(result, { id: "live-cache" });
    const cache = investigation.stages.find((stage) => stage.id === "cache-analysis");

    expect(cache).toMatchObject({ status: "warning" });
    expect(cache?.evidence).toContainEqual(
      expect.objectContaining({ id: "cache-disposition", value: "ambiguous" }),
    );
  });

  it("produces stable graph IDs for the same diagnostics", () => {
    const first = adaptHttpDiagnosticToInvestigation(diagnostic(), { id: "first" });
    const second = adaptHttpDiagnosticToInvestigation(diagnostic(), { id: "second" });

    expect(first.stages.map((stage) => stage.id)).toEqual(second.stages.map((stage) => stage.id));
    expect(first.stages.flatMap((stage) => stage.evidence.map((item) => item.id))).toEqual(
      second.stages.flatMap((stage) => stage.evidence.map((item) => item.id)),
    );
  });
});
