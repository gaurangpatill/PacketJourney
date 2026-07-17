import type { CounterfactualScenario } from "../schemas";
import type { CounterfactualRule } from "../types";
import { CounterfactualError } from "../types";
import { SimulationBuilder, isVerifiedStage, stageEvidenceIds } from "../builder";

type Scenario = Extract<CounterfactualScenario, { type: "enable-edge-cache" }>;

export const enableEdgeCacheRule: CounterfactualRule<Scenario> = {
  type: "enable-edge-cache",
  ruleId: "cache.edge-html.v1",
  version: 1,
  apply(source, scenario) {
    const builder = new SimulationBuilder(source, scenario, this.ruleId);
    const cache = builder.stage(scenario.targetCacheStageId, "cache");
    const origin = builder.stage(scenario.targetOriginStageId, "origin");
    if (!isVerifiedStage(origin) || origin.status === "error") {
      throw new CounterfactualError(
        "missing_evidence",
        "Edge caching requires a successful verified origin response stage.",
      );
    }
    if (
      !cache.connections.includes(origin.id) &&
      !builder.draft.stages.some((stage) => stage.connections.includes(origin.id))
    ) {
      throw new CounterfactualError(
        "ineligible_scenario",
        "The selected origin is not identifiable on this cache path.",
      );
    }
    const originSuccessors = [...origin.connections];
    cache.connections = [
      ...new Set(cache.connections.flatMap((id) => (id === origin.id ? originSuccessors : [id]))),
    ];
    cache.status = "success";
    cache.title = "Simulated edge cache hit";
    cache.shortTitle = "Cache hit";
    cache.description = `${source.title} HTML is assumed eligible for an edge-cache response.`;
    cache.simulation = builder.metadata("modified");
    origin.simulation = builder.metadata("unreachable");
    const evidenceId = builder.addEvidence(cache, "edge-cache-hit", "Simulated cache disposition", {
      disposition: "hit",
      measured: false,
      originBypassed: true,
    });
    builder.record({
      targetType: "stage",
      targetId: origin.id,
      operation: "unavailable",
      field: "activePath",
      observedValue: true,
      simulatedValue: false,
      reason: "A simulated HTML cache hit bypasses the origin on the active response path.",
      sourceEvidenceIds: stageEvidenceIds(origin),
    });
    builder.recalculateMetric(
      "totalDurationMs",
      Math.max(0, source.metrics.totalDurationMs - (origin.durationMs ?? 0)),
      "Subtracts the observed origin-stage duration from the supported sequential estimate.",
    );
    builder.unavailableMetric(
      "timeToFirstByteMs",
      "A real edge response was not executed, so a new TTFB is unavailable.",
    );
    for (const metric of [
      "firstContentfulPaintMs",
      "largestContentfulPaintMs",
      "domContentLoadedMs",
      "loadEventMs",
    ] as const) {
      builder.unavailableMetric(
        metric,
        "Browser rendering was not rerun against a cached HTML response.",
      );
    }
    builder.resolveFindings(
      (finding) =>
        finding.category === "cache" &&
        finding.evidenceIds.some((id) => cache.evidence.some((item) => item.id === id)),
      "The registered simulation replaces the selected cache-miss/configuration condition with a cache hit.",
    );
    builder.addFinding({
      id: `sim-${scenario.id}-cache-hit`,
      severity: "info",
      category: "cache",
      title: "HTML served from simulated edge cache",
      explanation:
        "This deterministic scenario bypasses the observed origin path. It does not prove the document is safe or correct to cache.",
      evidenceIds: [evidenceId],
      confidence: 1,
    });
    builder.assume(
      "The HTML can be cached without violating personalization, authorization, cookie, or freshness requirements.",
      "cache",
      "high",
    );
    builder.assume(
      "The cached representation is functionally equivalent to the observed origin response.",
      "cache",
      "high",
    );
    return builder.finish(
      "The simulated active path serves HTML from the selected edge cache and bypasses measured origin work; downstream user timing remains unknown.",
      "bounded",
    );
  },
};
