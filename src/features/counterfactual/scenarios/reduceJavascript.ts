import type { EvidenceItem, JourneyStage } from "../../investigation/schema";
import { SimulationBuilder } from "../builder";
import { byteText, parseByteText, resourceEvidence, resourceSummaryEvidence } from "../resources";
import type { CounterfactualScenario } from "../schemas";
import type { CounterfactualRule } from "../types";
import { CounterfactualError } from "../types";

type Scenario = Extract<CounterfactualScenario, { type: "reduce-javascript" }>;

function displayScriptTransfer(stage: JourneyStage): EvidenceItem | undefined {
  const script = stage.evidence.some(
    (item) => /resource type/i.test(item.label) && /script|javascript/i.test(String(item.value)),
  );
  return script
    ? stage.evidence.find(
        (item) => /transfer/i.test(item.label) && parseByteText(item.value) !== undefined,
      )
    : undefined;
}

export const reduceJavascriptRule: CounterfactualRule<Scenario> = {
  type: "reduce-javascript",
  ruleId: "resource.javascript-transfer.v1",
  version: 1,
  apply(source, scenario) {
    const builder = new SimulationBuilder(source, scenario, this.ruleId);
    const allCollections = resourceEvidence(builder.draft);
    const primaryCollections = scenario.targetStageId
      ? allCollections.filter(({ stage }) => stage.id === scenario.targetStageId)
      : allCollections.filter(({ evidence }) => evidence.label === "Browser resources");
    const collections = primaryCollections.length ? primaryCollections : allCollections;
    const scriptResources = collections.flatMap(({ stage, evidence, resources }) =>
      resources
        .filter((resource) => resource.type === "script" && resource.transferSize !== undefined)
        .map((resource) => ({ stage, evidence, resource })),
    );
    const displayStages = scriptResources.length
      ? []
      : builder.draft.stages
          .filter((stage) => !scenario.targetStageId || stage.id === scenario.targetStageId)
          .flatMap((stage) => {
            const evidence = displayScriptTransfer(stage);
            return evidence ? [{ stage, evidence, bytes: parseByteText(evidence.value)! }] : [];
          });
    const observedBytes =
      scriptResources.reduce((total, item) => total + (item.resource.transferSize ?? 0), 0) +
      displayStages.reduce((total, item) => total + item.bytes, 0);
    if (observedBytes <= 0) {
      throw new CounterfactualError(
        "missing_evidence",
        "Verified JavaScript transfer bytes are required.",
      );
    }
    const targetBytes =
      scenario.targetBytes ??
      Math.round(observedBytes * (1 - (scenario.reductionPercent ?? 0) / 100));
    if (targetBytes >= observedBytes) {
      throw new CounterfactualError(
        "invalid_scenario",
        "The JavaScript target must be smaller than observed transfer bytes.",
      );
    }
    const factor = targetBytes / observedBytes;
    for (const collection of collections) {
      const next = collection.resources.map((resource) =>
        resource.type === "script" && resource.transferSize !== undefined
          ? { ...resource, transferSize: Math.round(resource.transferSize * factor) }
          : resource,
      );
      collection.evidence.value = next;
      collection.evidence.simulation = builder.metadata("modified");
      collection.stage.simulation = builder.metadata("modified");
    }
    for (const item of displayStages) {
      item.evidence.value = byteText(Math.round(item.bytes * factor));
      item.evidence.simulation = builder.metadata("modified");
      item.stage.simulation = builder.metadata("modified");
    }
    const summary = resourceSummaryEvidence(builder.draft);
    if (summary?.evidence.value && typeof summary.evidence.value === "object") {
      const value = { ...(summary.evidence.value as Record<string, unknown>) };
      if (typeof value.javascriptTransferBytes === "number")
        value.javascriptTransferBytes = targetBytes;
      if (typeof value.totalTransferBytes === "number")
        value.totalTransferBytes = Math.max(
          0,
          value.totalTransferBytes - (observedBytes - targetBytes),
        );
      summary.evidence.value = value;
      summary.evidence.simulation = builder.metadata("modified");
      summary.stage.simulation = builder.metadata("modified");
    }
    builder.record({
      targetType: "resource",
      targetId: scenario.targetStageId ?? "all-javascript",
      operation: "modified",
      field: "transferSize",
      observedValue: observedBytes,
      simulatedValue: targetBytes,
      reason:
        "The registered rule applies one bounded byte-reduction factor to known JavaScript transfer values.",
      sourceEvidenceIds: [
        ...new Set([
          ...scriptResources.map((item) => item.evidence.id),
          ...displayStages.map((item) => item.evidence.id),
        ]),
      ],
    });
    if (source.metrics.transferredBytes !== undefined) {
      builder.recalculateMetric(
        "transferredBytes",
        source.metrics.transferredBytes - (observedBytes - targetBytes),
        "Subtracts the exact known JavaScript byte delta from the observed transfer total.",
      );
    } else {
      builder.unavailableMetric(
        "transferredBytes",
        "The observed investigation did not provide a complete transfer total.",
      );
    }
    for (const metric of [
      "firstContentfulPaintMs",
      "largestContentfulPaintMs",
      "domContentLoadedMs",
      "loadEventMs",
      "browserDurationMs",
    ] as const) {
      builder.unavailableMetric(
        metric,
        "Transfer reduction does not specify JavaScript parse, execution, scheduling, or rendering behavior.",
      );
    }
    builder.assume(
      "Compression and bundling produce the selected transfer size without changing application behavior.",
      "resource",
      "high",
    );
    builder.assume(
      "JavaScript execution cost is not derived from transferred bytes.",
      "browser",
      "high",
    );
    return builder.finish(
      `Known JavaScript transfer is reduced from ${observedBytes} to ${targetBytes} bytes; execution and paint effects remain unavailable.`,
      "bounded",
    );
  },
};
