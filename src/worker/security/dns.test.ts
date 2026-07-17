// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { AddressResolverDnsQueryClient, CloudflareDohClient, CloudflareDohResolver } from "./dns";

describe("DNS query provenance", () => {
  it("labels direct Cloudflare DoH results with the resolver API source", async () => {
    const client = new CloudflareDohClient(
      vi.fn().mockResolvedValue(Response.json({ Status: 0, Answer: [] })),
    );

    await expect(client.query("example.com", "A")).resolves.toMatchObject({
      source: "Cloudflare 1.1.1.1 DNS-over-HTTPS JSON API",
    });
  });

  it("labels compatibility results as injected resolver evidence", async () => {
    const client = new AddressResolverDnsQueryClient({
      resolve: vi.fn().mockResolvedValue(["93.184.216.34"]),
    });

    await expect(client.query("example.com", "A")).resolves.toMatchObject({
      source: "Injected address resolver adapter",
    });
  });
});

describe("CloudflareDohResolver", () => {
  it("collects only A and AAAA addresses from bounded responses", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          Status: 0,
          Answer: [
            { type: 5, data: "alias.example.com." },
            { type: 1, data: "93.184.216.34" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          Status: 0,
          Answer: [{ type: 28, data: "2606:2800:220:1:248:1893:25c8:1946" }],
        }),
      );

    await expect(new CloudflareDohResolver(fetcher).resolve("example.com")).resolves.toEqual([
      "93.184.216.34",
      "2606:2800:220:1:248:1893:25c8:1946",
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual", cache: "no-store" });
  });

  it("fails closed when no address records are returned", async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ Status: 3 })));

    await expect(new CloudflareDohResolver(fetcher).resolve("missing.example")).rejects.toThrow(
      "did not resolve to a public address",
    );
  });
});
