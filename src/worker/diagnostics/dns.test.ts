import { describe, expect, it } from "vitest";
import {
  collectDnsDiagnostic,
  interpretDnssec,
  MAX_CNAME_DEPTH,
  MAX_TXT_VALUE_LENGTH,
} from "./dns";
import {
  DNS_RECORD_CODES,
  type DnsQueryClient,
  type DnsQueryResult,
  type DnsRecordType,
} from "../security/dns";

type FixtureRecord = { name?: string; type: DnsRecordType; data: string; TTL?: number };
type FixtureReply = {
  status?: number;
  ad?: boolean;
  comment?: string;
  answers?: FixtureRecord[];
};

class FixtureDnsClient implements DnsQueryClient {
  readonly calls: string[] = [];

  constructor(private readonly replies: Record<string, FixtureReply>) {}

  query(hostname: string, recordType: DnsRecordType): Promise<DnsQueryResult> {
    this.calls.push(`${hostname}|${recordType}`);
    const reply = this.replies[`${hostname}|${recordType}`] ?? {};
    return Promise.resolve({
      hostname,
      recordType,
      response: {
        Status: reply.status ?? 0,
        ...(reply.ad === undefined ? {} : { AD: reply.ad }),
        ...(reply.comment ? { Comment: reply.comment } : {}),
        Answer: (reply.answers ?? []).map((record) => ({
          name: record.name ?? `${hostname}.`,
          type: DNS_RECORD_CODES[record.type],
          TTL: record.TTL ?? 300,
          data: record.data,
        })),
      },
      collectedAt: "2026-07-16T12:00:00.000Z",
      durationMs: 2,
      source: "Cloudflare 1.1.1.1 DNS-over-HTTPS JSON API",
    });
  }
}

function addressReplies(hostname = "example.com"): Record<string, FixtureReply> {
  return {
    [`${hostname}|A`]: {
      ad: true,
      answers: [{ type: "A", data: "93.184.216.34", TTL: 120 }],
    },
    [`${hostname}|AAAA`]: {
      ad: true,
      answers: [{ type: "AAAA", data: "2606:2800:220:1:248:1893:25c8:1946" }],
    },
    [`${hostname}|CNAME`]: { ad: true },
  };
}

describe("collectDnsDiagnostic", () => {
  it("collects direct A and AAAA records with TTLs and canonical address policy", async () => {
    const result = await collectDnsDiagnostic(
      "Example.COM",
      new FixtureDnsClient(addressReplies()),
      {
        includeDetailRecords: false,
        monotonicNow: (() => {
          let tick = 0;
          return () => (tick += 5);
        })(),
      },
    );

    expect(result.hostname).toBe("example.com");
    expect(result.status).toBe("success");
    expect(result.aliasChain).toEqual([]);
    expect(result.addresses).toHaveLength(2);
    expect(result.records.find((record) => record.type === "A")).toMatchObject({ ttl: 120 });
    expect(result.addresses.every((address) => address.assessment.allowed)).toBe(true);
    expect(result.dnssec.status).toBe("authenticated");
  });

  it("reconstructs multiple aliases without duplicate records", async () => {
    const client = new FixtureDnsClient({
      "app.example.com|CNAME": {
        ad: true,
        answers: [{ type: "CNAME", data: "customer.host.test.", TTL: 60 }],
      },
      "customer.host.test|CNAME": {
        ad: true,
        answers: [{ type: "CNAME", data: "edge.host.test.", TTL: 30 }],
      },
      "edge.host.test|CNAME": { ad: true },
      ...addressReplies("edge.host.test"),
    });
    const result = await collectDnsDiagnostic("app.example.com", client, {
      includeDetailRecords: false,
    });

    expect(result.aliasChain.map(({ from, to, ttl }) => ({ from, to, ttl }))).toEqual([
      { from: "app.example.com", to: "customer.host.test", ttl: 60 },
      { from: "customer.host.test", to: "edge.host.test", ttl: 30 },
    ]);
    expect(result.terminalHostname).toBe("edge.host.test");
    expect(result.addresses).toHaveLength(2);
  });

  it("detects an alias loop and preserves the observed steps", async () => {
    const result = await collectDnsDiagnostic(
      "a.example.com",
      new FixtureDnsClient({
        "a.example.com|CNAME": { answers: [{ type: "CNAME", data: "b.example.com." }] },
        "b.example.com|CNAME": { answers: [{ type: "CNAME", data: "a.example.com." }] },
      }),
      { includeDetailRecords: false },
    );

    expect(result.error?.code).toBe("cname_loop");
    expect(result.aliasChain).toHaveLength(2);
    expect(result.records).toHaveLength(2);
  });

  it("bounds alias traversal", async () => {
    const replies: Record<string, FixtureReply> = {};
    for (let index = 0; index <= MAX_CNAME_DEPTH; index += 1) {
      replies[`alias-${index}.example.com|CNAME`] = {
        answers: [{ type: "CNAME", data: `alias-${index + 1}.example.com.` }],
      };
    }
    const result = await collectDnsDiagnostic(
      "alias-0.example.com",
      new FixtureDnsClient(replies),
      { includeDetailRecords: false },
    );

    expect(result.error?.code).toBe("maximum_cname_depth");
    expect(result.aliasChain).toHaveLength(MAX_CNAME_DEPTH);
  });

  it("reports a missing terminal address without discarding alias evidence", async () => {
    const result = await collectDnsDiagnostic(
      "app.example.com",
      new FixtureDnsClient({
        "app.example.com|CNAME": {
          answers: [{ type: "CNAME", data: "missing.example.net." }],
        },
      }),
      { includeDetailRecords: false },
    );

    expect(result.error?.code).toBe("no_usable_address");
    expect(result.aliasChain).toHaveLength(1);
    expect(result.addresses).toEqual([]);
  });

  it("fails closed when public and prohibited addresses are mixed", async () => {
    const replies = addressReplies();
    replies["example.com|A"] = {
      answers: [
        { type: "A", data: "93.184.216.34" },
        { type: "A", data: "169.254.169.254" },
      ],
    };
    const result = await collectDnsDiagnostic("example.com", new FixtureDnsClient(replies), {
      includeDetailRecords: false,
    });

    expect(result.error?.code).toBe("mixed_prohibited_addresses");
    expect(result.addresses.filter((address) => address.assessment.allowed)).toHaveLength(2);
    expect(result.addresses.filter((address) => !address.assessment.allowed)).toHaveLength(1);
  });

  it("normalizes internationalized names and bounds sanitized TXT output", async () => {
    const client = new FixtureDnsClient({
      ...addressReplies("xn--bcher-kva.example"),
      "xn--bcher-kva.example|TXT": {
        answers: [{ type: "TXT", data: `"${"x".repeat(700)}\u0001"` }],
      },
    });
    const result = await collectDnsDiagnostic("bücher.example", client);
    const txt = result.records.find((record) => record.type === "TXT");

    expect(result.hostname).toBe("xn--bcher-kva.example");
    expect(txt?.value.length).toBe(MAX_TXT_VALUE_LENGTH);
    expect(txt?.value).not.toContain("\u0001");
  });

  it("deduplicates repeated address records", async () => {
    const replies = addressReplies();
    replies["example.com|A"] = {
      answers: [
        { type: "A", data: "93.184.216.34" },
        { type: "A", data: "93.184.216.34" },
      ],
    };
    const result = await collectDnsDiagnostic("example.com", new FixtureDnsClient(replies), {
      includeDetailRecords: false,
    });
    expect(result.records.filter((record) => record.type === "A")).toHaveLength(1);
  });
});

describe("interpretDnssec", () => {
  function query(ad?: boolean, status = 0, comment?: string): DnsQueryResult {
    return {
      hostname: "example.com",
      recordType: "A",
      response: {
        Status: status,
        ...(ad === undefined ? {} : { AD: ad }),
        ...(comment ? { Comment: comment } : {}),
      },
      collectedAt: "2026-07-16T12:00:00.000Z",
      durationMs: 1,
      source: "Cloudflare 1.1.1.1 DNS-over-HTTPS JSON API",
    };
  }

  it("uses careful language for authenticated, failed, and unavailable responses", () => {
    expect(interpretDnssec([query(true)]).status).toBe("authenticated");
    expect(interpretDnssec([query(false, 2, "DNSSEC Bogus")]).status).toBe("validation-failed");
    expect(interpretDnssec([query()]).status).toBe("unavailable");
    expect(interpretDnssec([query(false)]).explanation).toContain("does not prove");
  });
});
