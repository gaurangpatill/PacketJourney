// @vitest-environment node
import { describe, expect, it } from "vitest";
import { investigationById } from "../../data/investigations";
import { inconclusiveDraft } from "./fixture";
import { validateAiDiagnosisOutput } from "./validation";
import type { CounterfactualAiContext } from "../../features/investigation/aiSchema";

const counterfactual: CounterfactualAiContext = {
  label: "SIMULATED · NOT MEASURED",
  scenarioId: "scenario-1",
  ruleId: "origin.duration.v1",
  engineVersion: "1.0.0",
  changes: [
    {
      id: "change-1",
      targetId: "origin",
      operation: "modified",
      reason: "The registered rule changed the origin duration.",
      sourceEvidenceIds: ["origin-e1"],
    },
  ],
  assumptions: [
    {
      id: "assumption-1",
      statement: "Response behavior remains unchanged.",
      importance: "high",
    },
  ],
};

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

  it("accepts exact counterfactual change and assumption references", () => {
    const draft = inconclusiveDraft("The simulated result is bounded by explicit provenance.");
    draft.counterfactualReferences = [
      { type: "change", id: "change-1", claim: "The rule modified the origin stage." },
      { type: "assumption", id: "assumption-1", claim: "Response behavior is assumed stable." },
    ];
    expect(
      validateAiDiagnosisOutput(draft, investigationById.get("slow-origin")!, counterfactual)
        .counterfactualReferences,
    ).toHaveLength(2);
  });

  it("rejects invented counterfactual provenance references", () => {
    const draft = inconclusiveDraft("An invented rule reference was proposed.");
    draft.counterfactualReferences = [
      { type: "change", id: "invented-change", claim: "Invented change." },
    ];
    expect(() =>
      validateAiDiagnosisOutput(draft, investigationById.get("slow-origin")!, counterfactual),
    ).toThrow(/outside this simulation/i);
  });
});
