// @vitest-environment node
import { describe, expect, it } from "vitest";
import { REFERENCE_CONFIG } from "../features/references/config";
import { referenceManifest } from "./manifest";
import { buildReferenceChunks, normalizeReferenceText, sha256Hex } from "./chunking";

describe("reference chunking", () => {
  it("normalizes controls and produces stable bounded IDs and hashes", async () => {
    const source = referenceManifest[0]!;
    const input = {
      source,
      sections: [
        {
          heading: "  Cache rules ",
          sectionPath: ["Caching", "Rules"],
          content: `one\u0000 two  \n\n${"storage semantics ".repeat(180)}`,
        },
      ],
      retrievedAt: "2026-07-01T00:00:00.000Z",
    };
    const first = await buildReferenceChunks(input);
    const second = await buildReferenceChunks(input);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(1);
    expect(
      first.every(
        (chunk) =>
          chunk.id.length <= 64 && chunk.content.length <= REFERENCE_CONFIG.maximumChunkCharacters,
      ),
    ).toBe(true);
    expect(first[0]?.contentHash).toBe(await sha256Hex(first[0]!.content));
    expect(normalizeReferenceText("a\u0000   b")).toBe("a b");
  });

  it("preserves heading hierarchy and ignores empty sections", async () => {
    const chunks = await buildReferenceChunks({
      source: referenceManifest[1]!,
      sections: [
        {
          heading: "Redirects",
          sectionPath: ["HTTP", "Redirects"],
          content: "The Location field identifies a redirect target.",
        },
        { heading: "Empty", sectionPath: ["Empty"], content: "  " },
      ],
      retrievedAt: "2026-07-01T00:00:00.000Z",
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.sectionPath).toEqual(["HTTP", "Redirects"]);
  });
});
