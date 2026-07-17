import { z } from "zod";
import { isIpAddress } from "./ip";

const DNS_ENDPOINT = "https://cloudflare-dns.com/dns-query";
const DNS_RESPONSE_LIMIT = 65_536;

const dohResponseSchema = z.object({
  Status: z.number().int(),
  Answer: z
    .array(
      z.object({
        type: z.number().int(),
        data: z.string(),
      }),
    )
    .optional(),
});

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

export class CloudflareDohResolver implements AddressResolver {
  constructor(private readonly fetcher: ResolverFetch = fetch) {}

  async resolve(hostname: string, signal?: AbortSignal): Promise<string[]> {
    const addresses = new Set<string>();

    for (const type of ["A", "AAAA"] as const) {
      const query = new URL(DNS_ENDPOINT);
      query.searchParams.set("name", hostname);
      query.searchParams.set("type", type);
      const response = await this.fetcher(query, {
        method: "GET",
        headers: { accept: "application/dns-json" },
        redirect: "error",
        cache: "no-store",
        signal,
      });

      if (!response.ok) {
        await response.body?.cancel();
        throw new DnsResolutionError("The destination hostname could not be safely resolved.");
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
      if (parsed.data.Status !== 0 && parsed.data.Status !== 3) {
        throw new DnsResolutionError("The destination hostname could not be safely resolved.");
      }

      for (const answer of parsed.data.Answer ?? []) {
        if ((answer.type === 1 || answer.type === 28) && isIpAddress(answer.data)) {
          addresses.add(answer.data);
        }
      }
    }

    if (addresses.size === 0) {
      throw new DnsResolutionError("The destination hostname did not resolve to a public address.");
    }
    return [...addresses];
  }
}
