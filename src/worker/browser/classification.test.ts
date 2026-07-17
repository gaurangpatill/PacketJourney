import { describe, expect, it } from "vitest";
import {
  classifyParty,
  classifyThirdParty,
  normalizeResourceType,
  registrableDomain,
} from "./classification";
import { sanitizeConsoleMessage, sanitizeObservedUrl } from "./sanitize";

describe("browser resource classification", () => {
  it("uses registrable domains across apex, subdomains, and multi-level suffixes", () => {
    expect(classifyParty("cdn.example.co.uk", "www.example.co.uk")).toMatchObject({
      firstParty: true,
    });
    expect(classifyParty("example-cdn.net", "www.example.co.uk")).toMatchObject({
      firstParty: false,
    });
    expect(registrableDomain("xn--bcher-kva.example")).toBe("xn--bcher-kva.example");
  });

  it("normalizes resource types and leaves unknown vendors unknown", () => {
    expect(normalizeResourceType("script")).toBe("script");
    expect(normalizeResourceType("subdocument")).toBe("iframe");
    expect(normalizeResourceType("manifest")).toBe("other");
    expect(classifyThirdParty("www.google-analytics.com", "script")).toBe("analytics");
    expect(classifyThirdParty("assets.unrecognized.example", "script")).toBe("unknown");
    expect(classifyThirdParty("assets.unrecognized.example", "font")).toBe("fonts");
  });

  it("removes query credentials and fragments from observed resource URLs", () => {
    expect(sanitizeObservedUrl("https://user:secret@example.com/a.js?token=secret#x")).toBe(
      "https://example.com/a.js",
    );
  });

  it("bounds and sanitizes console messages", () => {
    const result = sanitizeConsoleMessage("bad\u0000" + "x".repeat(2_000));
    expect(result.message).not.toContain("\u0000");
    expect(result.message).toHaveLength(1_024);
    expect(result.truncated).toBe(true);
  });
});
