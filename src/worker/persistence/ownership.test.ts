import { describe, expect, it } from "vitest";
import { resolveAnonymousOwner } from "./ownership";

describe("anonymous installation ownership", () => {
  it("issues an HttpOnly same-site cookie and exposes only its hash as owner ID", async () => {
    const owner = await resolveAnonymousOwner(new Request("https://api.packetjourney.dev/test"));
    expect(owner.ownerId).toMatch(/^[0-9a-f]{64}$/);
    expect(owner.setCookie).toContain("pj_installation=");
    expect(owner.setCookie).toContain("HttpOnly");
    expect(owner.setCookie).toContain("SameSite=Lax");
    expect(owner.setCookie).toContain("Secure");
    expect(owner.setCookie).not.toContain(owner.ownerId);
  });

  it("resolves the same owner from a valid existing cookie without rotating it", async () => {
    const token = "a".repeat(43);
    const first = await resolveAnonymousOwner(
      new Request("http://localhost/test", { headers: { cookie: `pj_installation=${token}` } }),
    );
    const second = await resolveAnonymousOwner(
      new Request("http://localhost/test", {
        headers: { cookie: `x=1; pj_installation=${token}` },
      }),
    );
    expect(first.ownerId).toBe(second.ownerId);
    expect(first.setCookie).toBeUndefined();
  });
});
