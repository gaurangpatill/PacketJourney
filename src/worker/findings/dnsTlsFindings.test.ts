import { describe, expect, it } from "vitest";
import type { CertificateDiagnosticResult } from "../diagnostics/certificate";
import type { DnsDiagnosticResult } from "../diagnostics/dns";
import {
  createDnsTlsFindings,
  type CertificateFindingEvidence,
  type DnsFindingEvidence,
} from "./dnsTlsFindings";

const collectedAt = "2026-07-16T12:00:00.000Z";

function dns(overrides: Partial<DnsDiagnosticResult> = {}): DnsDiagnosticResult {
  return {
    hostname: "example.com",
    status: "success",
    records: [],
    aliasChain: [],
    terminalHostname: "example.com",
    addresses: [
      {
        hostname: "example.com",
        recordType: "A",
        ttl: 300,
        assessment: { address: "93.184.216.34", version: 4, range: "unicast", allowed: true },
      },
    ],
    queries: [],
    dnssec: {
      status: "inconclusive",
      explanation: "The resolver did not authenticate every answer.",
      authenticatedDataSignals: [false],
      comments: [],
      source: "Resolver flags",
    },
    startedAt: collectedAt,
    completedAt: collectedAt,
    durationMs: 2,
    ...overrides,
  };
}

function dnsEvidence(result: DnsDiagnosticResult): DnsFindingEvidence {
  return {
    result,
    recordsId: "dns-records",
    aliasesId: "dns-aliases",
    addressesId: "dns-addresses",
    dnssecId: "dns-dnssec",
    ...(result.error ? { errorId: "dns-error" } : {}),
  };
}

function certificateEvidence(result: CertificateDiagnosticResult): CertificateFindingEvidence {
  return {
    result,
    limitationsId: "tls-limitations",
    ...(result.error ? { errorId: "tls-error" } : {}),
  };
}

describe("createDnsTlsFindings", () => {
  it("does not create a high-severity DNSSEC claim from inconclusive evidence", () => {
    const findings = createDnsTlsFindings([dnsEvidence(dns())], []);
    expect(findings.some((finding) => finding.severity === "high")).toBe(false);
    expect(findings.find((finding) => finding.id.includes("dnssec"))).toBeUndefined();
  });

  it("links long aliases and resolver-reported DNSSEC failures to evidence", () => {
    const result = dns({
      aliasChain: [
        { from: "a.example", to: "b.example", ttl: 60, sourceRecord: {} as never },
        { from: "b.example", to: "c.example", ttl: 60, sourceRecord: {} as never },
        { from: "c.example", to: "d.example", ttl: 60, sourceRecord: {} as never },
      ],
      dnssec: {
        status: "validation-failed",
        explanation: "Resolver reported failure.",
        authenticatedDataSignals: [false],
        comments: ["DNSSEC Bogus"],
        source: "Resolver flags",
      },
    });
    const findings = createDnsTlsFindings([dnsEvidence(result)], []);
    expect(findings).toContainEqual(
      expect.objectContaining({
        title: "Resolver reported DNSSEC validation failure",
        evidenceIds: ["dns-dnssec"],
      }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        title: "Long DNS alias chain observed",
        evidenceIds: ["dns-aliases"],
      }),
    );
  });

  it("treats unavailable certificate inspection as informational, not invalidity", () => {
    const result: CertificateDiagnosticResult = {
      hostname: "example.com",
      connectionAddress: "93.184.216.34",
      status: "warning",
      startedAt: collectedAt,
      completedAt: collectedAt,
      durationMs: 3,
      error: {
        code: "probe_connection_failed",
        message: "Probe failed.",
        retryable: true,
      },
    };
    const findings = createDnsTlsFindings([], [certificateEvidence(result)]);
    expect(findings).toEqual([
      expect.objectContaining({
        title: "Independent certificate inspection unavailable",
        severity: "info",
        evidenceIds: ["tls-error"],
      }),
    ]);
  });
});
