// @vitest-environment node
import { describe, expect, it } from "vitest";
import { investigationById, investigations } from "../../data/investigations";
import { readAiRuntimeConfig } from "./config";
import { FixtureAiClient } from "./fixture";
import { diagnoseInvestigation } from "./orchestrator";

const config = readAiRuntimeConfig({ ENVIRONMENT: "test", AI_FIXTURE_MODE: "true" });

describe("evidence-grounded AI orchestrator", () => {
  it("returns schema-valid cited fixture diagnoses across seeded scenarios", async () => {
    for (const investigation of investigations) {
      const result = await diagnoseInvestigation({
        investigation,
        question: "What can the evidence support, and what remains unknown?",
        expertiseMode: "developer",
        client: new FixtureAiClient(),
        config,
      });
      const evidenceIds = new Set(
        investigation.stages.flatMap((stage) => stage.evidence.map((item) => item.id)),
      );
      expect(
        result.diagnosis.evidenceReferences.every((reference) =>
          evidenceIds.has(reference.evidenceId),
        ),
      ).toBe(true);
      expect(result.diagnosis.source).toBe("fixture");
    }
  });

  it("does not call the model when relevant evidence is absent", async () => {
    const investigation = structuredClone(investigationById.get("fast-cached")!);
    investigation.stages.find((stage) => stage.type === "dns")!.evidence = [];
    const client = {
      plan: () => Promise.reject(new Error("must not run")),
      diagnose: () => Promise.reject(new Error("must not run")),
    };
    const result = await diagnoseInvestigation({
      investigation,
      question: "Is the DNS configuration healthy?",
      expertiseMode: "developer",
      client,
      config,
    });
    expect(result.diagnosis.conclusionType).toBe("inconclusive");
    expect(result.diagnosis.source).toBe("evidence-guard");
  });
});
