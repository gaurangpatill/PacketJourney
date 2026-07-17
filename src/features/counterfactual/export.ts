import { counterfactualResultSchema, type CounterfactualResult } from "./schemas";

export function counterfactualExport(resultInput: CounterfactualResult) {
  const result = counterfactualResultSchema.parse(resultInput);
  return {
    format: "packet-journey-counterfactual",
    version: 1,
    label: result.label,
    generatedAt: result.generatedAt,
    engineVersion: result.engineVersion,
    sourceInvestigationId: result.sourceInvestigationId,
    scenario: result.scenario,
    summary: result.summary,
    changes: result.changes,
    assumptions: result.assumptions,
    metricDecisions: result.metricDecisions,
    unavailableMetrics: result.unavailableMetrics,
    resolvedFindingIds: result.resolvedFindingIds,
    simulatedFindings: result.simulatedFindings,
    observed: {
      id: result.observed.id,
      url: result.observed.normalizedUrl,
      metrics: result.observed.metrics,
    },
    simulated: {
      id: result.simulated.id,
      metrics: result.simulated.metrics,
      stages: result.simulated.stages.map((stage) => ({
        id: stage.id,
        type: stage.type,
        status: stage.status,
        durationMs: stage.durationMs,
        connections: stage.connections,
        simulation: stage.simulation,
      })),
    },
  };
}

export function serializeCounterfactualExport(result: CounterfactualResult): string {
  const serialized = JSON.stringify(counterfactualExport(result), null, 2);
  if (serialized.length > 512_000)
    throw new Error("Counterfactual export exceeds the 512 KB client-side limit.");
  return serialized;
}
