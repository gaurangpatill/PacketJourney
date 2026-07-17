// @vitest-environment node
import { describe, expect, it } from "vitest";
import { investigationSchema } from "../../features/investigation/schema";
import type { CertificateDiagnosticResult, CertificateEvidence } from "../diagnostics/certificate";
import type { DnsDiagnosticResult } from "../diagnostics/dns";
import type { HttpDiagnosticResult, NetworkDiagnosticResult } from "../diagnostics/types";
import type { BrowserDiagnosticResult } from "../browser/types";
import {
  adaptHttpDiagnosticToInvestigation,
  adaptNetworkDiagnosticToInvestigation,
} from "./investigation";

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

function dnsResult(
  hostname = "example.com",
  overrides: Partial<DnsDiagnosticResult> = {},
): DnsDiagnosticResult {
  return {
    hostname,
    status: "success",
    records: [],
    aliasChain: [],
    terminalHostname: hostname,
    addresses: [
      {
        hostname,
        recordType: "A",
        ttl: 300,
        assessment: { address: "93.184.216.34", version: 4, range: "unicast", allowed: true },
      },
    ],
    queries: [],
    dnssec: {
      status: "unavailable",
      explanation: "Resolver metadata unavailable.",
      authenticatedDataSignals: [],
      comments: [],
      source: "Fixture resolver",
    },
    startedAt,
    completedAt,
    durationMs: 5,
    ...overrides,
  };
}

function certificateEvidence(hostname = "example.com"): CertificateEvidence {
  return {
    requestedHostname: hostname,
    connectionHostname: hostname,
    connectionAddress: "93.184.216.34",
    subject: { commonName: hostname },
    subjectAlternativeNames: [hostname],
    sanValuesTruncated: false,
    issuer: { commonName: "Fixture CA" },
    serialNumber: "01",
    validFrom: "2026-07-01T00:00:00.000Z",
    validUntil: "2026-10-01T00:00:00.000Z",
    daysUntilExpiration: 77,
    validityStatus: "valid",
    hostnameCoverage: {
      covered: true,
      matchedName: hostname,
      matchType: "exact-san",
      explanation: "Exact SAN match.",
    },
    chain: [],
    chainTruncated: false,
    publicKeyAlgorithm: "RSA",
    publicKeyBits: 2048,
    signatureAlgorithm: "unavailable",
    observationKind: "served-peer",
    source: "Independent Cloudflare Worker node:tls certificate probe",
    collectedAt: completedAt,
    durationMs: 7,
    fetchSessionMetadata: {
      tlsVersion: "unavailable",
      cipherSuite: "unavailable",
      alpn: "unavailable",
      handshakeDurationMs: "unavailable",
      tcpDurationMs: "unavailable",
      explanation: "The fetch session is separate.",
    },
  };
}

function certificateResult(hostname = "example.com"): CertificateDiagnosticResult {
  return {
    hostname,
    connectionAddress: "93.184.216.34",
    status: "success",
    startedAt,
    completedAt,
    durationMs: 7,
    certificate: certificateEvidence(hostname),
  };
}

function network(
  http: HttpDiagnosticResult = diagnostic(),
  overrides: Partial<NetworkDiagnosticResult> = {},
): NetworkDiagnosticResult {
  return {
    http,
    dns: [dnsResult()],
    certificates: [certificateResult()],
    startedAt,
    completedAt,
    totalDurationMs: 140,
    ...overrides,
  };
}

function browserResult(overrides: Partial<BrowserDiagnosticResult> = {}): BrowserDiagnosticResult {
  return {
    status: "success",
    requestedUrl: "https://example.com/",
    finalUrl: "https://example.com/",
    title: "Example",
    mainDocumentStatus: 200,
    mainDocumentContentType: "text/html",
    redirectCount: 0,
    readiness: "loaded",
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
    navigation: {
      timeToFirstByteMs: 100,
      domContentLoadedMs: 300,
      loadEventMs: 500,
      firstContentfulPaintMs: 200,
    },
    resources: [
      {
        id: "script",
        url: "https://example.com/app.js",
        origin: "https://example.com",
        hostname: "example.com",
        type: "script",
        method: "GET",
        status: 200,
        transferSize: 20_000,
        startTimeMs: 100,
        durationMs: 80,
        firstParty: true,
        classificationBasis: "fixture",
        failed: false,
        renderBlockingCandidate: false,
      },
      {
        id: "analytics",
        url: "https://www.google-analytics.com/collect",
        origin: "https://www.google-analytics.com",
        hostname: "www.google-analytics.com",
        type: "fetch",
        method: "POST",
        status: 204,
        transferSize: 1_000,
        startTimeMs: 250,
        durationMs: 60,
        firstParty: false,
        classificationBasis: "fixture",
        thirdPartyCategory: "analytics",
        failed: false,
        renderBlockingCandidate: false,
      },
    ],
    resourceSummary: {
      totalObserved: 2,
      retained: 2,
      truncated: false,
      firstPartyCount: 1,
      thirdPartyCount: 1,
      failedCount: 0,
      totalTransferBytes: 21_000,
      javascriptTransferBytes: 20_000,
      thirdPartyTransferBytes: 1_000,
      domains: 2,
    },
    console: [],
    consoleTruncated: false,
    blockedRequests: [],
    artifact: {
      id: "123e4567-e89b-42d3-a456-426614174000",
      type: "screenshot",
      label: "Rendered page screenshot",
      storage: "r2",
      contentType: "image/jpeg",
      sizeBytes: 3,
      createdAt: completedAt,
      expiresAt: "2026-07-18T20:00:00.000Z",
      access: "worker-mediated",
      url: "/api/v1/artifacts/screenshots/123e4567-e89b-42d3-a456-426614174000",
    },
    errors: [],
    limitations: ["Fixture lab session."],
    startedAt,
    completedAt,
    durationMs: 900,
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

describe("DNS and TLS investigation adapter", () => {
  it("places DNS and TLS before the final HTTPS response without graph-specific data", () => {
    const investigation = adaptNetworkDiagnosticToInvestigation(network(), {
      id: "network-direct",
    });
    expect(investigationSchema.safeParse(investigation).success).toBe(true);
    expect(investigation.stages.map((stage) => stage.id)).toEqual([
      "input",
      "dns-1",
      "tls-1",
      "http-response",
      "cache-analysis",
      "document-received",
    ]);
    expect(investigation.metrics).toMatchObject({ dnsMs: 5, tlsMs: 7, totalDurationMs: 140 });
    expect(investigation.stages.every((stage) => !("position" in stage))).toBe(true);
  });

  it("places same-host TLS after HTTP upgrades to HTTPS and does not duplicate DNS", () => {
    const http = diagnostic({
      normalizedUrl: {
        canonicalUrl: "http://example.com/",
        displayUrl: "http://example.com/",
        hostname: "example.com",
        protocol: "http:",
      },
      redirects: [
        {
          index: 0,
          sourceUrl: "http://example.com/",
          status: 301,
          statusText: "Moved Permanently",
          location: "https://example.com/",
          destinationUrl: "https://example.com/",
          destinationValidation: "passed",
          durationMs: 10,
          headers: { location: "https://example.com/" },
          headersTruncated: false,
          collectedAt: startedAt,
        },
      ],
    });
    const investigation = adaptNetworkDiagnosticToInvestigation(network(http), { id: "upgrade" });
    expect(investigation.stages.map((stage) => stage.id).slice(0, 5)).toEqual([
      "input",
      "dns-1",
      "redirect-1",
      "tls-1",
      "http-response",
    ]);
    expect(investigation.stages.filter((stage) => stage.type === "dns")).toHaveLength(1);
  });

  it("preserves a certificate-probe warning while keeping successful HTTP evidence", () => {
    const unavailable: CertificateDiagnosticResult = {
      hostname: "example.com",
      connectionAddress: "93.184.216.34",
      status: "warning",
      startedAt,
      completedAt,
      durationMs: 5,
      error: {
        code: "probe_connection_failed",
        message: "Probe unavailable.",
        retryable: true,
      },
    };
    const investigation = adaptNetworkDiagnosticToInvestigation(
      network(diagnostic(), { certificates: [unavailable] }),
      { id: "cert-partial" },
    );
    expect(investigation.status).toBe("completed");
    expect(investigation.stages.find((stage) => stage.type === "tls")).toMatchObject({
      status: "warning",
    });
    expect(investigation.findings).toContainEqual(
      expect.objectContaining({
        title: "Independent certificate inspection unavailable",
        severity: "info",
      }),
    );
  });

  it("links expired and hostname-mismatch findings to TLS evidence", () => {
    const observed = certificateEvidence();
    observed.validityStatus = "expired";
    observed.daysUntilExpiration = -2;
    observed.hostnameCoverage = {
      covered: false,
      matchType: "none",
      explanation: "No SAN covered the host.",
    };
    const investigation = adaptNetworkDiagnosticToInvestigation(
      network(diagnostic(), {
        certificates: [{ ...certificateResult(), certificate: observed }],
      }),
      { id: "invalid-cert" },
    );
    const tlsEvidenceIds = new Set(
      investigation.stages.find((stage) => stage.type === "tls")?.evidence.map((item) => item.id),
    );
    const tlsFindings = investigation.findings.filter((finding) => finding.category === "tls");
    expect(tlsFindings.map((finding) => finding.severity)).toEqual(["high", "high"]);
    expect(
      tlsFindings.flatMap((finding) => finding.evidenceIds).every((id) => tlsEvidenceIds.has(id)),
    ).toBe(true);
  });

  it("does not treat CT issuance metadata as the certificate served by HTTP fetch", () => {
    const issuance = certificateEvidence();
    issuance.observationKind = "certificate-transparency";
    issuance.source = "Fixture Certificate Transparency API";
    issuance.validityStatus = "expired";
    issuance.daysUntilExpiration = -2;
    issuance.hostnameCoverage = {
      covered: false,
      matchType: "none",
      explanation: "Fixture mismatch.",
    };
    const investigation = adaptNetworkDiagnosticToInvestigation(
      network(diagnostic(), {
        certificates: [{ ...certificateResult(), status: "warning", certificate: issuance }],
      }),
      { id: "ct-only" },
    );
    const tlsFindings = investigation.findings.filter((finding) => finding.category === "tls");
    expect(tlsFindings).toEqual([
      expect.objectContaining({
        title: "Certificate Transparency issuance observed",
        severity: "info",
      }),
    ]);
    expect(investigation.stages.find((stage) => stage.type === "tls")?.status).toBe("warning");
  });
});

describe("browser investigation adapter", () => {
  it("adds a primary browser path and bounded resource branches", () => {
    const investigation = adaptNetworkDiagnosticToInvestigation(
      network(diagnostic(), { browser: browserResult(), totalDurationMs: 1_040 }),
      { id: "browser-success" },
    );

    expect(investigationSchema.safeParse(investigation).success).toBe(true);
    expect(investigation.stages.map((stage) => stage.id)).toEqual(
      expect.arrayContaining([
        "document-received",
        "browser-investigation",
        "browser-complete",
        "browser-group-1",
        "browser-group-2",
      ]),
    );
    const browser = investigation.stages.find((stage) => stage.id === "browser-investigation");
    expect(browser?.connections).toEqual(
      expect.arrayContaining(["browser-complete", "browser-group-1", "browser-group-2"]),
    );
    expect(investigation.stages.filter((stage) => stage.type === "third-party")).toHaveLength(1);
    expect(investigation.metrics).toMatchObject({
      browserDurationMs: 900,
      firstContentfulPaintMs: 200,
      requestCount: 2,
      thirdPartyCount: 1,
      transferredBytes: 21_000,
    });
    expect(investigation.artifacts).toHaveLength(1);
  });

  it("preserves HTTP evidence when the browser binding is unavailable", () => {
    const unavailable = browserResult({
      status: "unavailable",
      readiness: "unavailable",
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
      artifact: undefined,
      errors: [
        {
          code: "browser_binding_unavailable",
          message: "Browser binding unavailable.",
          retryable: false,
          phase: "binding",
        },
      ],
    });
    const investigation = adaptNetworkDiagnosticToInvestigation(
      network(diagnostic(), { browser: unavailable }),
      { id: "browser-unavailable" },
    );

    expect(investigation.status).toBe("completed");
    expect(investigation.stages.find((stage) => stage.id === "http-response")).toBeDefined();
    expect(
      investigation.stages.find((stage) => stage.id === "browser-investigation"),
    ).toMatchObject({ status: "warning", title: "Browser investigation unavailable" });
    expect(investigation.stages.some((stage) => stage.id === "browser-complete")).toBe(false);
    expect(investigation.findings).toContainEqual(
      expect.objectContaining({ id: "finding-browser-unavailable", severity: "info" }),
    );
  });

  it("retains partial resources and screenshot state after a browser timeout", () => {
    const partial = browserResult({
      status: "partial",
      readiness: "partial",
      errors: [
        {
          code: "browser_navigation_timeout",
          message: "Navigation timed out.",
          retryable: true,
          phase: "navigation",
        },
      ],
    });
    const investigation = adaptNetworkDiagnosticToInvestigation(
      network(diagnostic(), { browser: partial }),
      { id: "browser-timeout" },
    );

    expect(investigation.status).toBe("completed");
    expect(investigation.stages.find((stage) => stage.id === "browser-investigation")?.status).toBe(
      "warning",
    );
    expect(investigation.artifacts).toHaveLength(1);
    expect(investigation.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining(["finding-browser-timeout", "finding-browser-partial-screenshot"]),
    );
  });
});
