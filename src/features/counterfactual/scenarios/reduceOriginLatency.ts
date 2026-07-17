import type { CounterfactualScenario } from "../schemas";
import type { CounterfactualRule } from "../types";
import { CounterfactualError } from "../types";
import { SimulationBuilder, isVerifiedStage, stageEvidenceIds } from "../builder";

type Scenario = Extract<CounterfactualScenario, { type: "reduce-origin-latency" }>;

export const reduceOriginLatencyRule: CounterfactualRule<Scenario> = {
  type: "reduce-origin-latency",
  ruleId: "origin.duration.v1",
  version: 1,
  apply(source, scenario) {
    const builder = new SimulationBuilder(source, scenario, this.ruleId);
    const stage = builder.stage(scenario.targetStageId);
    if (stage.type !== "origin" || stage.durationMs === undefined || !isVerifiedStage(stage)) {
      throw new CounterfactualError(
        "missing_evidence",
        "A verified origin stage with measured duration is required.",
      );
    }
    if (scenario.targetDurationMs > stage.durationMs) {
      throw new CounterfactualError(
        "invalid_scenario",
        "An origin improvement cannot exceed the observed duration.",
      );
    }
    const observed = stage.durationMs;
    stage.durationMs = scenario.targetDurationMs;
    stage.status = "success";
    stage.simulation = builder.metadata("modified");
    const evidenceId = builder.addEvidence(stage, "origin-duration", "Simulated origin duration", {
      observedMs: observed,
      targetMs: scenario.targetDurationMs,
      deltaMs: scenario.targetDurationMs - observed,
    });
    builder.record({
      targetType: "stage",
      targetId: stage.id,
      operation: "modified",
      field: "durationMs",
      observedValue: observed,
      simulatedValue: scenario.targetDurationMs,
      reason: "The user selected a bounded lower origin duration.",
      sourceEvidenceIds: stageEvidenceIds(stage).filter((id) => id !== evidenceId),
    });
    builder.recalculateMetric(
      "totalDurationMs",
      source.metrics.totalDurationMs - (observed - scenario.targetDurationMs),
      "Applies the exact origin-stage delta to the sequential journey total.",
    );
    builder.unavailableMetric(
      "timeToFirstByteMs",
      "The Worker did not execute a response with the simulated origin duration.",
    );
    for (const metric of [
      "firstContentfulPaintMs",
      "largestContentfulPaintMs",
      "domContentLoadedMs",
      "loadEventMs",
    ] as const) {
      builder.unavailableMetric(
        metric,
        "A network-stage reduction does not deterministically establish new browser paint or lifecycle timing.",
      );
    }
    builder.assume(
      "The lower origin duration does not change response content, status, headers, or downstream resource behavior.",
      "origin",
      "high",
    );
    return builder.finish(
      `Origin duration is reduced by ${observed - scenario.targetDurationMs} ms; browser timing is deliberately not estimated.`,
      "high",
    );
  },
};
