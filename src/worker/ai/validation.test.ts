// @vitest-environment node
import { describe, expect, it } from "vitest";
import { investigationById } from "../../data/investigations";
import { inconclusiveDraft } from "./fixture";
import { validateAiDiagnosisOutput } from "./validation";

describe("AI output validation", () => {
  it("accepts a polished inconclusive response without citations", () => {
    expect(
      validateAiDiagnosisOutput(
        inconclusiveDraft("Browser evidence is unavailable."),
        investigationById.get("fast-cached")!,
      ).conclusionType,
    ).toBe("inconclusive");
  });

  it("rejects unknown evidence and stage references", () => {
    const draft = inconclusiveDraft("More evidence is needed.");
    draft.evidenceReferences = [
      { evidenceId: "invented", stageId: "dns", claim: "Invented claim" },
    ];
    expect(() => validateAiDiagnosisOutput(draft, investigationById.get("fast-cached")!)).toThrow(
      /outside this investigation/i,
    );
  });

  it("rejects overconfident inconclusive output", () => {
    const draft = inconclusiveDraft("More evidence is needed.");
    draft.confidence = 0.9;
    expect(() => validateAiDiagnosisOutput(draft, investigationById.get("fast-cached")!)).toThrow(
      /cannot claim high confidence/i,
    );
  });

  it("rejects category-mismatched citations", () => {
    const investigation = investigationById.get("fast-cached")!;
    const draft = inconclusiveDraft("A finding was proposed.");
    draft.primaryFinding = {
      title: "Certificate issue",
      explanation: "A cache value was incorrectly cited for TLS.",
      category: "tls",
      severity: "medium",
      confidence: 0.4,
      evidenceIds: ["cache-e1"],
    };
    expect(() => validateAiDiagnosisOutput(draft, investigation)).toThrow(/unrelated/i);
  });
});
