// @vitest-environment node
import { describe, expect, it } from "vitest";
import { aiDiagnosisSchema } from "../../features/investigation/aiSchema";
import { FixtureAiClient } from "../ai/fixture";
import { FixtureReferenceRetriever } from "./retrieval";
import { investigationById } from "../../data/investigations";
import { validateDiagnosisReferences, validateFrozenCitation } from "./validation";

describe("frozen reference citation validation", () => {
  it("accepts allowlisted fixture citations and rejects generated URLs", async () => {
    const investigation = investigationById.get("missing-cache")!;
    const retrieval = await new FixtureReferenceRetriever().retrieve({
      question: "Why was this response not cached with no-store?",
      investigation,
      expertiseMode: "developer",
    });
    const citation = retrieval.citations[0]!;
    expect(validateFrozenCitation(citation)).toBe(citation);
    expect(() =>
      validateFrozenCitation({ ...citation, canonicalUrl: "https://attacker.example/reference" }),
    ).toThrow("allowlisted");
  });

  it("rejects a model citation outside the frozen snapshot", async () => {
    const investigation = investigationById.get("missing-cache")!;
    const retrieval = await new FixtureReferenceRetriever().retrieve({
      question: "Explain cache-control no-store",
      investigation,
      expertiseMode: "developer",
    });
    const context = { evidence: [], summary: { findings: [] } } as never;
    const draft = (
      await new FixtureAiClient().diagnose({
        question: "cache",
        context,
        toolResults: [],
        config: {} as never,
        references: retrieval.citations,
      })
    ).output as Record<string, unknown>;
    const diagnosis = aiDiagnosisSchema.parse({
      ...draft,
      id: "diagnosis-test",
      question: "Explain cache",
      generatedAt: "2026-07-17T00:00:00.000Z",
      model: "fixture",
      promptVersion: "v1",
      source: "fixture",
      referenceCitations: retrieval.citations,
      retrievalMetadata: retrieval.metadata,
    });
    validateDiagnosisReferences(diagnosis);
    expect(() =>
      validateDiagnosisReferences({
        ...diagnosis,
        technicalReferences: [{ citationId: "citation-invented-id", claim: "invented" }],
      }),
    ).toThrow("outside");
  });
});
