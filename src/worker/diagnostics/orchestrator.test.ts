import { describe, expect, it, vi } from "vitest";
import { readRuntimeLimits } from "../env";
import {
  DNS_RECORD_CODES,
  type DnsQueryClient,
  type DnsQueryResult,
  type DnsRecordType,
} from "../security/dns";
import type { CertificateDiagnosticResult, CertificateInspector } from "./certificate";
import { investigateNetworkJourney } from "./orchestrator";

class FixtureDnsClient implements DnsQueryClient {
  readonly calls: string[] = [];

  constructor(private readonly addresses: Record<string, string[]>) {}

  query(hostname: string, recordType: DnsRecordType): Promise<DnsQueryResult> {
    this.calls.push(`${hostname}|${recordType}`);
    const addresses = this.addresses[hostname];
    return Promise.resolve({
      hostname,
      recordType,
      response: {
        Status: addresses ? 0 : 3,
        AD: true,
        Answer: (recordType === "A" || recordType === "AAAA" ? (addresses ?? []) : [])
          .filter((address) =>
            recordType === "A" ? !address.includes(":") : address.includes(":"),
          )
          .map((address) => ({
            name: `${hostname}.`,
            type: DNS_RECORD_CODES[recordType],
            TTL: 300,
            data: address,
          })),
      },
      collectedAt: "2026-07-16T12:00:00.000Z",
      durationMs: 1,
      source: "Cloudflare 1.1.1.1 DNS-over-HTTPS JSON API",
    });
  }
}

class FixtureCertificateInspector implements CertificateInspector {
  readonly hostnames: string[] = [];

  inspect(hostname: string, connectionAddress: string): Promise<CertificateDiagnosticResult> {
    this.hostnames.push(hostname);
    return Promise.resolve({
      hostname,
      connectionAddress,
      status: "warning",
      startedAt: "2026-07-16T12:00:00.000Z",
      completedAt: "2026-07-16T12:00:00.001Z",
      durationMs: 1,
      error: {
        code: "certificate_unavailable",
        message: "Fixture certificate probe unavailable.",
        retryable: true,
      },
    });
  }
}

const limits = readRuntimeLimits({});

describe("investigateNetworkJourney", () => {
  it("runs DNS, independent certificate inspection, and HTTP for direct HTTPS", async () => {
    const dnsClient = new FixtureDnsClient({ "example.com": ["93.184.216.34"] });
    const certificateInspector = new FixtureCertificateInspector();
    const result = await investigateNetworkJourney("https://example.com", limits, {
      dnsClient,
      certificateInspector,
      fetcher: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    });

    expect(result.dns.map((item) => item.hostname)).toEqual(["example.com"]);
    expect(certificateInspector.hostnames).toEqual(["example.com"]);
    expect(result.http.finalResponse?.status).toBe(200);
  });

  it("starts TLS only after an HTTP-to-HTTPS redirect without duplicating DNS", async () => {
    const dnsClient = new FixtureDnsClient({ "example.com": ["93.184.216.34"] });
    const certificateInspector = new FixtureCertificateInspector();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 301, headers: { location: "https://example.com/" } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const result = await investigateNetworkJourney("http://example.com", limits, {
      dnsClient,
      certificateInspector,
      fetcher,
    });

    expect(result.dns).toHaveLength(1);
    expect(certificateInspector.hostnames).toEqual(["example.com"]);
    expect(result.http.redirects).toHaveLength(1);
  });

  it("collects distinct evidence for an apex-to-www or cross-domain boundary", async () => {
    const dnsClient = new FixtureDnsClient({
      "example.com": ["93.184.216.34"],
      "www.example.com": ["142.250.72.196"],
    });
    const certificateInspector = new FixtureCertificateInspector();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 308, headers: { location: "https://www.example.com/" } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const result = await investigateNetworkJourney("https://example.com", limits, {
      dnsClient,
      certificateInspector,
      fetcher,
    });

    expect(result.dns.map((item) => item.hostname)).toEqual(["example.com", "www.example.com"]);
    expect(certificateInspector.hostnames).toEqual(["example.com", "www.example.com"]);
  });

  it("returns a structured DNS terminal result and never starts HTTP when no address exists", async () => {
    const fetcher = vi.fn();
    const result = await investigateNetworkJourney("https://missing.example", limits, {
      dnsClient: new FixtureDnsClient({}),
      certificateInspector: new FixtureCertificateInspector(),
      fetcher,
    });

    expect(result.http.error).toMatchObject({
      code: "dns_resolution_failed",
      stage: "dns",
    });
    expect(result.dns[0]?.error?.code).toBe("no_usable_address");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves initial evidence when a redirect hostname cannot resolve", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://missing.example/" },
      }),
    );
    const result = await investigateNetworkJourney("https://example.com", limits, {
      dnsClient: new FixtureDnsClient({ "example.com": ["93.184.216.34"] }),
      certificateInspector: new FixtureCertificateInspector(),
      fetcher,
    });

    expect(result.dns.map((item) => item.hostname)).toEqual(["example.com", "missing.example"]);
    expect(result.http.redirects).toHaveLength(1);
    expect(result.http.error?.code).toBe("blocked_redirect_destination");
    expect(result.dns[1]?.error?.code).toBe("no_usable_address");
  });
});
