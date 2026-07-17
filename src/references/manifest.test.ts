// @vitest-environment node
import { describe, expect, it } from "vitest";
import { referenceManifest, validateReferenceManifest } from "./manifest";

describe("reference source manifest", () => {
  it("contains only reviewed HTTPS publishers and unique sources", () => {
    expect(validateReferenceManifest()).toHaveLength(17);
    expect(new Set(referenceManifest.map((item) => item.publisher))).toEqual(
      new Set(["cloudflare", "ietf", "mdn", "owasp", "web-dev", "cab-forum"]),
    );
    expect(referenceManifest.every((item) => item.canonicalUrl.startsWith("https://"))).toBe(true);
  });

  it("rejects duplicate IDs, duplicate URLs, and non-HTTPS entries", () => {
    expect(() => validateReferenceManifest([referenceManifest[0]!, referenceManifest[0]!])).toThrow(
      "Duplicate",
    );
    expect(() =>
      validateReferenceManifest([
        {
          ...referenceManifest[0]!,
          sourceId: "different-source",
          canonicalUrl: "http://example.com/reference",
        },
      ]),
    ).toThrow("HTTPS");
    expect(() =>
      validateReferenceManifest([
        {
          ...referenceManifest[0]!,
          sourceId: "different-source",
          canonicalUrl: referenceManifest[0]!.canonicalUrl,
        },
        referenceManifest[0]!,
      ]),
    ).toThrow("Duplicate");
  });
});
