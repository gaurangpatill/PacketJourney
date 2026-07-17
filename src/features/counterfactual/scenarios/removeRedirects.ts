import type { CounterfactualScenario } from "../schemas";
import type { CounterfactualRule } from "../types";
import { CounterfactualError } from "../types";
import { SimulationBuilder, isVerifiedStage, stageEvidenceIds } from "../builder";

type Scenario = Extract<CounterfactualScenario, { type: "remove-redirects" }>;

export const removeRedirectsRule: CounterfactualRule<Scenario> = {
  type: "remove-redirects",
  ruleId: "redirect.remove.v1",
  version: 1,
  apply(source, scenario) {
    const builder = new SimulationBuilder(source, scenario, this.ruleId);
    const targets = scenario.targetStageIds.map((id) => builder.stage(id, "redirect"));
    if (new Set(targets.map((stage) => stage.id)).size !== targets.length) {
      throw new CounterfactualError("invalid_scenario", "Redirect targets must be unique.");
    }
    if (targets.some((stage) => !isVerifiedStage(stage))) {
      throw new CounterfactualError(
        "missing_evidence",
        "Only verified redirect stages can be removed.",
      );
    }
    let removedDuration = 0;
    for (const stage of targets) {
      const predecessors = builder.draft.stages.filter((candidate) =>
        candidate.connections.includes(stage.id),
      );
      const successors = [...stage.connections];
      for (const predecessor of predecessors) {
        predecessor.connections = [
          ...new Set(
            predecessor.connections.flatMap((id) => (id === stage.id ? successors : [id])),
          ),
        ];
        for (const successor of successors) {
          builder.record({
            targetType: "edge",
            targetId: `${predecessor.id}::${successor}`,
            operation: "added",
            reason: "The selected redirect is bypassed while preserving destination order.",
            sourceEvidenceIds: stageEvidenceIds(stage),
          });
        }
      }
      removedDuration += stage.durationMs ?? 0;
      builder.record({
        targetType: "stage",
        targetId: stage.id,
        operation: "removed",
        observedValue: stage.title,
        reason: "The registered rule removes this verified redirect hop.",
        sourceEvidenceIds: stageEvidenceIds(stage),
      });
      builder.draft.stages = builder.draft.stages.filter((candidate) => candidate.id !== stage.id);
    }
    if (!builder.draft.stages.some((stage) => stage.type === "redirect")) {
      builder.resolveFindings(
        (finding) => finding.category === "redirect",
        "No redirect stages remain in the simulated path.",
      );
    }
    builder.recalculateMetric(
      "totalDurationMs",
      Math.max(0, source.metrics.totalDurationMs - removedDuration),
      "Subtracts only the measured sequential durations of removed redirect stages.",
    );
    for (const metric of [
      "firstContentfulPaintMs",
      "largestContentfulPaintMs",
      "domContentLoadedMs",
      "loadEventMs",
    ] as const) {
      builder.unavailableMetric(
        metric,
        "Direct navigation was not executed, so downstream browser timing cannot be recalculated.",
      );
    }
    builder.assume(
      "The final destination accepts a direct request with behavior equivalent to the observed redirected navigation.",
      "network",
      "high",
    );
    builder.assume(
      "Distinct-host DNS, TLS, and security boundaries remain required and were not removed automatically.",
      "network",
      "medium",
    );
    return builder.finish(
      `${targets.length} verified redirect stage${targets.length === 1 ? " was" : "s were"} removed; only their measured sequential duration was subtracted.`,
      "bounded",
    );
  },
};
