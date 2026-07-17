// @vitest-environment node
import { describe, expect, it } from "vitest";
import { identifyInfrastructureClues } from "./infrastructure";

describe("infrastructure clues", () => {
  it("reports Cloudflare only when target response headers support it", () => {
    expect(identifyInfrastructureClues({ server: "nginx" })).not.toContainEqual(
      expect.objectContaining({ id: "cloudflare-edge" }),
    );
    expect(identifyInfrastructureClues({ "cf-ray": "abc-IAD" })).toContainEqual(
      expect.objectContaining({ id: "cloudflare-edge", confidence: "verified" }),
    );
  });

  it("labels vendor patterns as inferred and raw response facts as verified", () => {
    const clues = identifyInfrastructureClues({
      "x-amz-cf-pop": "IAD89-P1",
      "content-encoding": "br",
      "content-length": "2048",
    });
    expect(clues).toContainEqual(
      expect.objectContaining({ id: "cloudfront-clue", confidence: "inferred" }),
    );
    expect(clues).toContainEqual(
      expect.objectContaining({ id: "compression", confidence: "verified" }),
    );
    expect(clues).toContainEqual(expect.objectContaining({ id: "content-length", value: 2048 }));
  });
});
