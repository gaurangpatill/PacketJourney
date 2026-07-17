import { z } from "zod";
import { assessIpAddress, isIpAddress } from "./ip";

export const CLOUDFLARE_DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";
export const DNS_RESPONSE_LIMIT = 65_536;
export const DNS_RECORD_LIMIT = 128;

export const DNS_RECORD_CODES = {
  A: 1,
  NS: 2,
  CNAME: 5,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  CAA: 257,
} as const;

export type DnsRecordType = keyof typeof DNS_RECORD_CODES;

const dohRecordSchema = z.object({
  name: z.string().max(1_024).optional(),
  type: z.number().int().nonnegative(),
  TTL: z.number().int().nonnegative().max(2_147_483_647).optional(),
  data: z.string().max(16_384),
});

export const dohResponseSchema = z.object({
  Status: z.number().int().nonnegative(),
  TC: z.boolean().optional(),
  RD: z.boolean().optional(),
  RA: z.boolean().optional(),
  AD: z.boolean().optional(),
  CD: z.boolean().optional(),
  Question: z
    .array(z.object({ name: z.string().max(1_024), type: z.number().int().nonnegative() }))
    .max(16)
    .optional(),
  Answer: z.array(dohRecordSchema).max(DNS_RECORD_LIMIT).optional(),
  Authority: z.array(dohRecordSchema).max(DNS_RECORD_LIMIT).optional(),
  Additional: z.array(dohRecordSchema).max(DNS_RECORD_LIMIT).optional(),
  Comment: z.union([z.string().max(4_096), z.array(z.string().max(1_024)).max(16)]).optional(),
});

export type DohResponse = z.infer<typeof dohResponseSchema>;

export interface DnsQueryResult {
  hostname: string;
  recordType: DnsRecordType;
  response: DohResponse;
  collectedAt: string;
  durationMs: number;
  source: string;
}

export interface DnsQueryClient {
  query(hostname: string, recordType: DnsRecordType, signal?: AbortSignal): Promise<DnsQueryResult>;
}

export interface AddressResolver {
  resolve(hostname: string, signal?: AbortSignal): Promise<string[]>;
}

export type ResolverFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class DnsResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DnsResolutionError";
  }
}

function roundedDuration(start: number, end: number): number {
  return Math.max(0, Math.round((end - start) * 100) / 100);
}

export class CloudflareDohClient implements DnsQueryClient {
  constructor(
    private readonly fetcher: ResolverFetch = (input, init) => fetch(input, init),
    private readonly monotonicNow: () => number = () => performance.now(),
    private readonly wallClockNow: () => Date = () => new Date(),
  ) {}

  async query(
    hostname: string,
    recordType: DnsRecordType,
    signal?: AbortSignal,
  ): Promise<DnsQueryResult> {
    const query = new URL(CLOUDFLARE_DOH_ENDPOINT);
    query.searchParams.set("name", hostname);
    query.searchParams.set("type", recordType);
    query.searchParams.set("do", "true");
    query.searchParams.set("cd", "false");
    const started = this.monotonicNow();
    const response = await this.fetcher(query, {
      method: "GET",
      headers: { accept: "application/dns-json" },
      redirect: "manual",
      cache: "no-store",
      signal,
    });

    if (!response.ok) {
      await response.body?.cancel();
      throw new DnsResolutionError("The DNS resolver did not accept the query.");
    }
    const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
    if (declaredLength > DNS_RESPONSE_LIMIT) {
      await response.body?.cancel();
      throw new DnsResolutionError("The DNS response exceeded the safety limit.");
    }

    const text = await response.text();
    if (text.length > DNS_RESPONSE_LIMIT) {
      throw new DnsResolutionError("The DNS response exceeded the safety limit.");
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      throw new DnsResolutionError("The DNS resolver returned malformed data.");
    }
    const parsed = dohResponseSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new DnsResolutionError("The DNS resolver returned an unexpected response.");
    }

    return {
      hostname,
      recordType,
      response: parsed.data,
      collectedAt: this.wallClockNow().toISOString(),
      durationMs: roundedDuration(started, this.monotonicNow()),
      source: "Cloudflare 1.1.1.1 DNS-over-HTTPS JSON API",
    };
  }
}

export class CachingDnsQueryClient implements DnsQueryClient {
  private readonly cache = new Map<string, Promise<DnsQueryResult>>();

  constructor(private readonly client: DnsQueryClient) {}

  query(
    hostname: string,
    recordType: DnsRecordType,
    signal?: AbortSignal,
  ): Promise<DnsQueryResult> {
    const key = `${hostname.toLowerCase()}|${recordType}`;
    const existing = this.cache.get(key);
    if (existing) return existing;
    const pending = this.client.query(hostname, recordType, signal).catch((error: unknown) => {
      this.cache.delete(key);
      throw error;
    });
    this.cache.set(key, pending);
    return pending;
  }
}

export class DnsQueryAddressResolver implements AddressResolver {
  constructor(private readonly client: DnsQueryClient) {}

  async resolve(hostname: string, signal?: AbortSignal): Promise<string[]> {
    const addresses = new Set<string>();

    for (const recordType of ["A", "AAAA"] as const) {
      const result = await this.client.query(hostname, recordType, signal);
      if (result.response.Status !== 0 && result.response.Status !== 3) {
        throw new DnsResolutionError("The destination hostname could not be safely resolved.");
      }
      for (const answer of result.response.Answer ?? []) {
        if (
          (answer.type === DNS_RECORD_CODES.A || answer.type === DNS_RECORD_CODES.AAAA) &&
          isIpAddress(answer.data)
        ) {
          addresses.add(assessIpAddress(answer.data).address);
        }
      }
    }

    if (addresses.size === 0) {
      throw new DnsResolutionError("The destination hostname did not resolve to a public address.");
    }
    return [...addresses];
  }
}

export class CloudflareDohResolver extends DnsQueryAddressResolver {
  constructor(fetcher: ResolverFetch = (input, init) => fetch(input, init)) {
    super(new CloudflareDohClient(fetcher));
  }
}

export class AddressResolverDnsQueryClient implements DnsQueryClient {
  constructor(
    private readonly resolver: AddressResolver,
    private readonly wallClockNow: () => Date = () => new Date(),
  ) {}

  async query(
    hostname: string,
    recordType: DnsRecordType,
    signal?: AbortSignal,
  ): Promise<DnsQueryResult> {
    const addresses =
      recordType === "A" || recordType === "AAAA"
        ? await this.resolver.resolve(hostname, signal)
        : [];
    return {
      hostname,
      recordType,
      response: {
        Status: 0,
        Answer: addresses
          .filter((address) => assessIpAddress(address).version === (recordType === "A" ? 4 : 6))
          .map((address) => ({
            name: `${hostname}.`,
            type: DNS_RECORD_CODES[recordType],
            TTL: 0,
            data: address,
          })),
      },
      collectedAt: this.wallClockNow().toISOString(),
      durationMs: 0,
      source: "Injected address resolver adapter",
    };
  }
}
