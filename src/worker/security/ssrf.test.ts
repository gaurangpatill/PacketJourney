// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { AddressResolver } from "./dns";
import { assessIpAddress } from "./ip";
import { validatePublicDestination } from "./ssrf";
import { normalizeInvestigationUrl } from "./url";

class StaticResolver implements AddressResolver {
  constructor(private readonly addresses: string[]) {}
  resolve(): Promise<string[]> {
    return Promise.resolve(this.addresses);
  }
}

describe("SSRF IP policy", () => {
  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "224.0.0.1",
    "240.0.0.1",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "ff00::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
  ])("blocks non-public address %s", (address) => {
    expect(assessIpAddress(address).allowed).toBe(false);
  });

  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])(
    "allows public unicast address %s",
    (address) => {
      expect(assessIpAddress(address).allowed).toBe(true);
    },
  );

  it.each(["http://127.1", "http://2130706433", "http://0x7f000001"])(
    "blocks unusual loopback representation %s after URL canonicalization",
    async (input) => {
      await expect(
        validatePublicDestination(normalizeInvestigationUrl(input), new StaticResolver([])),
      ).rejects.toMatchObject({ code: "blocked_ip_range" });
    },
  );
});

describe("SSRF hostname policy", () => {
  it.each([
    "http://localhost",
    "http://service.internal",
    "http://router.local",
    "http://metadata.google.internal",
  ])("blocks internal hostname %s", async (input) => {
    await expect(
      validatePublicDestination(normalizeInvestigationUrl(input), new StaticResolver(["1.1.1.1"])),
    ).rejects.toMatchObject({ code: "internal_hostname" });
  });

  it("blocks a hostname when any observed DNS answer is private", async () => {
    await expect(
      validatePublicDestination(
        normalizeInvestigationUrl("https://public.example"),
        new StaticResolver(["1.1.1.1", "10.0.0.5"]),
      ),
    ).rejects.toMatchObject({ code: "blocked_ip_range" });
  });

  it("accepts a safe public hostname with public answers", async () => {
    await expect(
      validatePublicDestination(
        normalizeInvestigationUrl("https://example.com"),
        new StaticResolver(["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]),
      ),
    ).resolves.toMatchObject({
      canonicalUrl: "https://example.com/",
      hostname: "example.com",
    });
  });
});
