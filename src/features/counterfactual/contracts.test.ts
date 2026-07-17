import { describe, expect, it } from "vitest";
import { investigations } from "../../data/investigations";
import { runCounterfactual } from "./engine";
import { serializeCounterfactualExport } from "./export";
import { counterfactualScenarioSchema } from "./schemas";

const metadata = {
  id: "contract-test",
  title: "Contract test",
  description: "Validate counterfactual contracts.",
  createdAt: "2026-07-17T12:00:00.000Z",
  source: "user" as const,
};

describe("counterfactual contracts", () => {
  it("requires exactly one JavaScript reduction input", () => {
    expect(
      counterfactualScenarioSchema.safeParse({
        ...metadata,
        type: "reduce-javascript",
        reductionPercent: 50,
        targetBytes: 1_000,
      }).success,
    ).toBe(false);
    expect(
      counterfactualScenarioSchema.safeParse({
        ...metadata,
        type: "reduce-javascript",
      }).success,
    ).toBe(false);
  });

  it("rejects unknown transformations before registry dispatch", () => {
    expect(
      counterfactualScenarioSchema.safeParse({
        ...metadata,
        type: "execute-expression",
        expression: "fetch('http://localhost')",
      }).success,
    ).toBe(false);
  });

  it("exports a bounded projection without artifacts or source evidence payloads", () => {
    const source = investigations.find((item) => item.id === "slow-origin")!;
    const result = runCounterfactual(source, {
      ...metadata,
      type: "reduce-origin-latency",
      targetStageId: "origin",
      targetDurationMs: 100,
    });
    const payload = JSON.parse(serializeCounterfactualExport(result)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      format: "packet-journey-counterfactual",
      label: "SIMULATED · NOT MEASURED",
      sourceInvestigationId: "slow-origin",
    });
    expect(JSON.stringify(payload)).not.toContain("artifacts");
    expect(JSON.stringify(payload)).not.toContain("Recorded diagnostic fixture");
  });
});
