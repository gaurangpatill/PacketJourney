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

  it("answers deterministic status questions without model inference", async () => {
    const client = {
      plan: () => Promise.reject(new Error("must not plan")),
      diagnose: () => Promise.reject(new Error("must not diagnose")),
    };
    const result = await diagnoseInvestigation({
      investigation: investigationById.get("fast-cached")!,
      question: "Is the certificate evidence healthy?",
      expertiseMode: "developer",
      selectedStageId: "tls",
      client,
      config,
    });

    expect(result.usage.toolCalls).toEqual([]);
    expect(result.diagnosis.source).toBe("evidence-guard");
    expect(result.diagnosis.evidenceReferences.length).toBeGreaterThan(0);
    expect(result.diagnosis.answer).toMatch(/does not prove/i);
  });

  it("surfaces an evidence-linked deterministic certificate failure", async () => {
    const result = await diagnoseInvestigation({
      investigation: investigationById.get("tls-warning")!,
      question: "Is the certificate valid?",
      expertiseMode: "developer",
      selectedStageId: "tls",
      client: {
        plan: () => Promise.reject(new Error("must not plan")),
        diagnose: () => Promise.reject(new Error("must not diagnose")),
      },
      config,
    });

    expect(result.diagnosis.source).toBe("evidence-guard");
    expect(result.diagnosis.conclusionType).toBe("supported");
    expect(result.diagnosis.primaryFinding?.severity).toBe("high");
    expect(result.diagnosis.evidenceReferences).toHaveLength(2);
  });

  it("skips planning for a narrow explanation while retaining model synthesis", async () => {
    const fixture = new FixtureAiClient();
    let planningCalls = 0;
    const result = await diagnoseInvestigation({
      investigation: investigationById.get("fast-cached")!,
      question: "Explain the certificate evidence.",
      expertiseMode: "developer",
      selectedStageId: "tls",
      client: {
        plan: () => {
          planningCalls += 1;
          return Promise.resolve({ toolCalls: [] });
        },
        diagnose: (input) => fixture.diagnose(input),
      },
      config,
    });

    expect(planningCalls).toBe(0);
    expect(result.diagnosis.source).toBe("fixture");
  });

  it("returns a deterministic evidence guard when model output is unsafe", async () => {
    const result = await diagnoseInvestigation({
      investigation: investigationById.get("fast-cached")!,
      question: "Explain the certificate evidence.",
      expertiseMode: "developer",
      client: {
        plan: () => Promise.resolve({ toolCalls: [] }),
        diagnose: () => Promise.resolve({ output: { invented: true }, rawCharacters: 17 }),
      },
      config,
    });

    expect(result.diagnosis.source).toBe("evidence-guard");
    expect(result.diagnosis.conclusionType).toBe("inconclusive");
    expect(result.diagnosis.answer).toMatch(/could not safely validate/i);
  });
});
