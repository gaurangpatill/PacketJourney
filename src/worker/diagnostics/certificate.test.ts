import { describe, expect, it, vi } from "vitest";
import type { DetailedPeerCertificate } from "node:tls";
import {
  CertSpotterCertificateInspector,
  FallbackCertificateInspector,
  MAX_SAN_VALUES,
  normalizePeerCertificate,
  parseDnsSubjectAlternativeNames,
  verifyCertificateHostname,
  type CertificateInspector,
} from "./certificate";

function fixture(overrides: Partial<DetailedPeerCertificate> = {}): DetailedPeerCertificate {
  const certificate = {
    subject: { CN: "example.com", O: "Example Corp" },
    issuer: { CN: "Example Test CA", O: "Example Trust" },
    subjectaltname: "DNS:example.com, DNS:www.example.com, DNS:*.apps.example.com",
    valid_from: "Jul 1 00:00:00 2026 GMT",
    valid_to: "Oct 1 00:00:00 2026 GMT",
    serialNumber: "01AB",
    fingerprint256: "AA:BB:CC",
    fingerprint: "AA",
    fingerprint512: "AA:BB",
    ca: false,
    raw: Buffer.from("certificate"),
    bits: 2048,
    modulus: "abc",
    issuerCertificate: undefined,
    ...overrides,
  };
  return certificate as unknown as DetailedPeerCertificate;
}

describe("verifyCertificateHostname", () => {
  it("matches exact SANs case-insensitively", () => {
    expect(verifyCertificateHostname("WWW.Example.COM", ["www.example.com"])).toMatchObject({
      covered: true,
      matchType: "exact-san",
    });
  });

  it("accepts one-label wildcards but rejects apex and deeper names", () => {
    expect(verifyCertificateHostname("app.example.com", ["*.example.com"]).covered).toBe(true);
    expect(verifyCertificateHostname("example.com", ["*.example.com"]).covered).toBe(false);
    expect(verifyCertificateHostname("a.b.example.com", ["*.example.com"]).covered).toBe(false);
  });

  it("normalizes internationalized hostnames", () => {
    expect(verifyCertificateHostname("bücher.example", ["xn--bcher-kva.example"])).toMatchObject({
      covered: true,
      matchType: "exact-san",
    });
  });

  it("uses the common name only when DNS SAN data is absent", () => {
    expect(verifyCertificateHostname("example.com", [], "example.com")).toMatchObject({
      covered: true,
      matchType: "exact-common-name",
    });
    expect(verifyCertificateHostname("example.com", ["other.example"], "example.com").covered).toBe(
      false,
    );
  });
});

describe("parseDnsSubjectAlternativeNames", () => {
  it("keeps DNS values, deduplicates, and ignores non-DNS SANs", () => {
    expect(
      parseDnsSubjectAlternativeNames(
        "DNS:example.com, IP Address:192.0.2.1, DNS:www.example.com, DNS:example.com",
      ),
    ).toEqual({ values: ["example.com", "www.example.com"], truncated: false });
  });

  it("bounds very large SAN lists", () => {
    const subjectAlternativeName = Array.from(
      { length: MAX_SAN_VALUES + 5 },
      (_, index) => `DNS:host-${index}.example.com`,
    ).join(", ");
    const parsed = parseDnsSubjectAlternativeNames(subjectAlternativeName);
    expect(parsed.values).toHaveLength(MAX_SAN_VALUES);
    expect(parsed.truncated).toBe(true);
  });
});

describe("normalizePeerCertificate", () => {
  it("normalizes a valid certificate without claiming HTTP fetch TLS metadata", () => {
    const result = normalizePeerCertificate(
      "www.example.com",
      "93.184.216.34",
      fixture(),
      new Date("2026-07-16T12:00:00.000Z"),
      15,
    );

    expect(result.validityStatus).toBe("valid");
    expect(result.daysUntilExpiration).toBe(77);
    expect(result.hostnameCoverage.covered).toBe(true);
    expect(result.publicKeyAlgorithm).toBe("RSA");
    expect(result.publicKeyBits).toBe(2048);
    expect(result.fetchSessionMetadata).toMatchObject({
      tlsVersion: "unavailable",
      cipherSuite: "unavailable",
      alpn: "unavailable",
      handshakeDurationMs: "unavailable",
      tcpDurationMs: "unavailable",
    });
  });

  it("classifies expired and not-yet-valid certificates", () => {
    const expired = normalizePeerCertificate(
      "example.com",
      "93.184.216.34",
      fixture({ valid_to: "Jul 1 00:00:00 2026 GMT" }),
      new Date("2026-07-16T12:00:00.000Z"),
      1,
    );
    const future = normalizePeerCertificate(
      "example.com",
      "93.184.216.34",
      fixture({ valid_from: "Aug 1 00:00:00 2026 GMT" }),
      new Date("2026-07-16T12:00:00.000Z"),
      1,
    );
    expect(expired.validityStatus).toBe("expired");
    expect(expired.daysUntilExpiration).toBeLessThan(0);
    expect(future.validityStatus).toBe("not-yet-valid");
  });

  it("keeps malformed validity fields explicitly unavailable", () => {
    const result = normalizePeerCertificate(
      "example.com",
      "93.184.216.34",
      fixture({ valid_from: "invalid", valid_to: "invalid" }),
      new Date("2026-07-16T12:00:00.000Z"),
      1,
    );
    expect(result).toMatchObject({
      validFrom: null,
      validUntil: null,
      daysUntilExpiration: null,
      validityStatus: "unavailable",
    });
  });

  it("normalizes a bounded issuer chain without following a circular root", () => {
    const root = fixture({
      subject: { CN: "Root CA" },
      issuer: { CN: "Root CA" },
      serialNumber: "ROOT",
      fingerprint256: "ROOT-FP",
    });
    root.issuerCertificate = root;
    const leaf = fixture({ issuerCertificate: root });
    const result = normalizePeerCertificate(
      "example.com",
      "93.184.216.34",
      leaf,
      new Date("2026-07-16T12:00:00.000Z"),
      1,
    );
    expect(result.chain).toHaveLength(2);
    expect(result.chainTruncated).toBe(false);
  });
});

describe("CertSpotterCertificateInspector", () => {
  it("normalizes the latest bounded CT issuance and labels it separately from the served peer", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json([
        {
          id: "older",
          cert_sha256: "old",
          dns_names: ["example.com"],
          issuer: { name: "CN=Older CA", friendly_name: "Older" },
          not_before: "2026-01-01T00:00:00Z",
          not_after: "2026-08-01T00:00:00Z",
        },
        {
          id: "newer",
          cert_sha256: "new",
          dns_names: ["example.com", "www.example.com"],
          issuer: { name: "CN=Fixture CA", friendly_name: "Fixture Trust" },
          not_before: "2026-07-01T00:00:00Z",
          not_after: "2026-10-01T00:00:00Z",
        },
      ]),
    );
    const inspector = new CertSpotterCertificateInspector({
      fetcher: fetcher as typeof fetch,
      apiToken: "test-token",
    });
    const result = await inspector.inspect("example.com", "93.184.216.34", {
      wallClockNow: () => new Date("2026-07-16T12:00:00.000Z"),
    });

    expect(result.status).toBe("warning");
    expect(result.certificate).toMatchObject({
      observationKind: "certificate-transparency",
      fingerprint256: "new",
      subjectAlternativeNames: ["example.com", "www.example.com"],
      hostnameCoverage: { covered: true },
      issuer: { organization: ["Fixture Trust"] },
    });
    const request = fetcher.mock.calls[0]?.[0] as URL;
    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(request.origin + request.pathname).toBe("https://api.certspotter.com/v1/issuances");
    expect(request.searchParams.get("domain")).toBe("example.com");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer test-token");
  });

  it("uses CT only when the direct peer inspector is unavailable", async () => {
    const primary: CertificateInspector = {
      inspect: vi.fn().mockResolvedValue({
        hostname: "example.com",
        connectionAddress: "93.184.216.34",
        status: "warning",
        startedAt: "2026-07-16T12:00:00.000Z",
        completedAt: "2026-07-16T12:00:00.000Z",
        durationMs: 1,
        error: { code: "probe_connection_failed", message: "Unavailable", retryable: true },
      }),
    };
    const ctResult = {
      hostname: "example.com",
      connectionAddress: "93.184.216.34",
      status: "warning" as const,
      startedAt: "2026-07-16T12:00:00.000Z",
      completedAt: "2026-07-16T12:00:00.000Z",
      durationMs: 1,
      certificate: {
        ...normalizePeerCertificate(
          "example.com",
          "93.184.216.34",
          fixture(),
          new Date("2026-07-16T12:00:00.000Z"),
          1,
        ),
        observationKind: "certificate-transparency" as const,
        source: "Fixture CT source",
      },
    };
    const fallback: CertificateInspector = { inspect: vi.fn().mockResolvedValue(ctResult) };
    const result = await new FallbackCertificateInspector(primary, fallback).inspect(
      "example.com",
      "93.184.216.34",
    );
    expect(result.certificate?.observationKind).toBe("certificate-transparency");
    expect(result.error?.code).toBe("probe_connection_failed");
  });

  it("returns a structured warning for malformed CT responses", async () => {
    const inspector = new CertSpotterCertificateInspector({
      fetcher: vi.fn().mockResolvedValue(Response.json({ unexpected: true })) as typeof fetch,
    });
    const result = await inspector.inspect("example.com", "93.184.216.34");
    expect(result).toMatchObject({
      status: "warning",
      error: {
        code: "certificate_transparency_unavailable",
        details: { reason: "invalid_response_shape" },
      },
    });
  });
});
