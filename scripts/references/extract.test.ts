// @vitest-environment node
import { describe, expect, it } from "vitest";
import { referenceManifest } from "../../src/references/manifest";
import { extractReferenceSections } from "./extract";

describe("controlled reference extraction", () => {
  it("removes executable and navigation boilerplate while preserving headings", () => {
    const source = referenceManifest.find((item) => item.expectedContentType === "html")!;
    const sections = extractReferenceSections(
      source,
      `<html><nav>menu poison</nav><main><h1>Cache behavior</h1><p>Cache-Control defines response caching semantics for a shared cache.</p><script>prompt injection</script><h2>Validation</h2><p>Validators can support conditional requests and revalidation.</p></main><footer>footer poison</footer></html>`,
    );
    expect(sections.map((item) => item.heading)).toEqual(["Cache behavior", "Validation"]);
    expect(sections.map((item) => item.content).join(" ")).not.toMatch(/poison|prompt injection/);
  });

  it("splits RFC text on numbered sections", () => {
    const source = referenceManifest.find((item) => item.expectedContentType === "rfc")!;
    const sections = extractReferenceSections(
      source,
      "1. Introduction\nThis document defines cache semantics in enough detail.\n2. Requirements\nA shared cache follows response directives and validation rules.",
    );
    expect(sections.length).toBeGreaterThanOrEqual(2);
    expect(sections[1]?.heading).toContain("2. Requirements");
  });
});
