import { SimulationBuilder, stageEvidenceIds } from "../builder";
import { parseByteText, resourceEvidence, resourceSummaryEvidence } from "../resources";
import type { CounterfactualScenario } from "../schemas";
import type { CounterfactualRule } from "../types";

type Scenario = Extract<CounterfactualScenario, { type: "remove-third-party" }>;

export const removeThirdPartyRule: CounterfactualRule<Scenario> = {
  type: "remove-third-party",
  ruleId: "third-party.remove.v1",
  version: 1,
  apply(source, scenario) {
    const builder = new SimulationBuilder(source, scenario, this.ruleId);
    const target = builder.stage(scenario.targetStageId, "third-party");
    const grouped = resourceEvidence(builder.draft).find(({ stage }) => stage.id === target.id);
    const resources = grouped?.resources ?? [];
    const hostnames = new Set(
      resources.flatMap((resource) => (resource.hostname ? [resource.hostname] : [])),
    );
    for (const item of target.evidence) {
      if (/^domain$/i.test(item.label) && typeof item.value === "string") hostnames.add(item.value);
    }
    const requestEvidence = target.evidence.find(
      (item) => /requests/i.test(item.label) && typeof item.value === "number",
    );
    const transferEvidence = target.evidence.find(
      (item) => /transfer/i.test(item.label) && parseByteText(item.value) !== undefined,
    );
    const removedCount =
      resources.length || (typeof requestEvidence?.value === "number" ? requestEvidence.value : 0);
    const removedBytes =
      resources.reduce((total, resource) => total + (resource.transferSize ?? 0), 0) ||
      parseByteText(transferEvidence?.value) ||
      0;
    const removedIds = new Set(resources.map((resource) => resource.id));
    for (const collection of resourceEvidence(builder.draft)) {
      if (collection.stage.id === target.id) continue;
      const next = collection.resources.filter((resource) => {
        if (removedIds.has(resource.id)) return false;
        return resource.hostname ? !hostnames.has(resource.hostname) : true;
      });
      if (next.length !== collection.resources.length) {
        collection.evidence.value = next;
        collection.evidence.simulation = builder.metadata("modified");
        collection.stage.simulation = builder.metadata("modified");
      }
    }
    const predecessors = builder.draft.stages.filter((stage) =>
      stage.connections.includes(target.id),
    );
    for (const predecessor of predecessors) {
      predecessor.connections = predecessor.connections.filter((id) => id !== target.id);
    }
    builder.draft.stages = builder.draft.stages.filter((stage) => stage.id !== target.id);
    builder.record({
      targetType: "stage",
      targetId: target.id,
      operation: "removed",
      observedValue: target.title,
      reason:
        "The selected existing third-party dependency group is removed from the simulated graph.",
      sourceEvidenceIds: stageEvidenceIds(target),
    });
    const summary = resourceSummaryEvidence(builder.draft);
    if (summary?.evidence.value && typeof summary.evidence.value === "object") {
      const value = { ...(summary.evidence.value as Record<string, unknown>) };
      if (typeof value.requestCount === "number")
        value.requestCount = Math.max(0, value.requestCount - removedCount);
      if (typeof value.thirdPartyCount === "number")
        value.thirdPartyCount = Math.max(0, value.thirdPartyCount - removedCount);
      if (typeof value.totalTransferBytes === "number" && removedBytes > 0)
        value.totalTransferBytes = Math.max(0, value.totalTransferBytes - removedBytes);
      summary.evidence.value = value;
      summary.evidence.simulation = builder.metadata("modified");
    }
    if (source.metrics.requestCount !== undefined && removedCount > 0) {
      builder.recalculateMetric(
        "requestCount",
        Math.max(0, source.metrics.requestCount - removedCount),
        "Subtracts requests directly attributed to the removed group.",
      );
    } else {
      builder.unavailableMetric(
        "requestCount",
        "A complete request count for the selected dependency group was not available.",
      );
    }
    if (source.metrics.thirdPartyCount !== undefined && removedCount > 0) {
      builder.recalculateMetric(
        "thirdPartyCount",
        Math.max(0, source.metrics.thirdPartyCount - removedCount),
        "Subtracts known requests in the removed third-party group.",
      );
    } else {
      builder.unavailableMetric(
        "thirdPartyCount",
        "The removed group's third-party request count was unavailable.",
      );
    }
    if (source.metrics.transferredBytes !== undefined && removedBytes > 0) {
      builder.recalculateMetric(
        "transferredBytes",
        Math.max(0, source.metrics.transferredBytes - removedBytes),
        "Subtracts only known transfer bytes attributed to the removed dependency.",
      );
    } else {
      builder.unavailableMetric(
        "transferredBytes",
        "Known transfer bytes were insufficient for a new total.",
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
        "Removing a dependency was not executed in a browser, so downstream behavior is unavailable.",
      );
    }
    const targetEvidence = new Set(stageEvidenceIds(target));
    builder.resolveFindings(
      (finding) =>
        finding.category === "third-party" &&
        finding.evidenceIds.some((id) => targetEvidence.has(id)),
      "The selected dependency group is absent only inside this simulation.",
    );
    builder.assume(
      "The page remains functionally and visually correct without this dependency.",
      "resource",
      "high",
    );
    builder.assume(
      "Unknown indirect requests and business behavior are not removed.",
      "browser",
      "high",
    );
    return builder.finish(
      `The ${target.title} group is removed. Known counts and bytes are adjusted; browser and functional effects remain unavailable.`,
      removedCount > 0 ? "bounded" : "low",
    );
  },
};
