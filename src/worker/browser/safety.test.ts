import { describe, expect, it } from "vitest";
import type { AddressResolver } from "../security/dns";
import { validateBrowserRequest } from "./safety";

class FixtureResolver implements AddressResolver {
  constructor(private readonly addresses: string[]) {}
  resolve(): Promise<string[]> {
    return Promise.resolve(this.addresses);
  }
}

describe("browser request safety", () => {
  it("accepts a validated public network destination", async () => {
    await expect(
      validateBrowserRequest(
        "https://cdn.example.com/app.js",
        false,
        new FixtureResolver(["93.184.216.34"]),
      ),
    ).resolves.toBe("network");
  });

  it.each([
    ["http://127.0.0.1/admin", ["127.0.0.1"]],
    ["http://169.254.169.254/latest", ["169.254.169.254"]],
    ["http://localhost/admin", ["127.0.0.1"]],
    ["http://private.example/admin", ["10.0.0.1"]],
  ])("blocks prohibited browser destination %s", async (url, addresses) => {
    await expect(
      validateBrowserRequest(url, true, new FixtureResolver(addresses)),
    ).rejects.toThrow();
  });

  it("allows passive embedded URLs only for subresources", async () => {
    const resolver = new FixtureResolver(["93.184.216.34"]);
    await expect(
      validateBrowserRequest("data:image/png;base64,AA==", false, resolver),
    ).resolves.toBe("passive");
    await expect(validateBrowserRequest("data:text/html,unsafe", true, resolver)).rejects.toThrow(
      "Unsupported browser request protocol",
    );
    await expect(validateBrowserRequest("file:///etc/passwd", true, resolver)).rejects.toThrow();
  });
});
