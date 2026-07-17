import { investigationSchema, type Investigation } from "../investigation/schema";
import { getCounterfactualRule } from "./registry";
import {
  COUNTERFACTUAL_ENGINE_VERSION,
  SIMULATION_LABEL,
  counterfactualResultSchema,
  counterfactualScenarioSchema,
  type CounterfactualResult,
  type CounterfactualScenario,
} from "./schemas";
import { CounterfactualError } from "./types";

function sourceEvidenceIds(investigation: Investigation) {
  return new Set(
    investigation.stages.flatMap((stage) => stage.evidence.map((evidence) => evidence.id)),
  );
}

function validateProvenance(
  source: Investigation,
  result: ReturnType<ReturnType<typeof getCounterfactualRule>["apply"]>,
) {
  const known = sourceEvidenceIds(source);
  for (const stage of result.simulated.stages) {
    for (const evidence of stage.evidence) known.add(evidence.id);
  }
  for (const change of result.changes) {
    for (const evidenceId of change.sourceEvidenceIds) {
      if (!known.has(evidenceId)) {
        throw new CounterfactualError(
          "invalid_reference",
          `Change ${change.id} cites missing evidence ${evidenceId}.`,
        );
      }
    }
  }
}

export function runCounterfactual(
  sourceInput: Investigation,
  scenarioInput: CounterfactualScenario,
): CounterfactualResult {
  const sourceSnapshot = JSON.stringify(sourceInput);
  const source = investigationSchema.parse(sourceInput);
  if (source.simulation) {
    throw new CounterfactualError(
      "ineligible_scenario",
      "A simulation cannot be used as observed source evidence.",
    );
  }
  const scenario = counterfactualScenarioSchema.parse(scenarioInput);
  const rule = getCounterfactualRule(scenario.type);
  const application = rule.apply(source, scenario);
  validateProvenance(source, application);
  if (JSON.stringify(sourceInput) !== sourceSnapshot) {
    throw new CounterfactualError(
      "unsupported_transformation",
      "A counterfactual rule mutated observed evidence.",
    );
  }
  const changedStageIds = new Set(
    application.changes
      .filter((change) => change.targetType === "stage" && change.operation !== "unchanged")
      .map((change) => change.targetId),
  );
  const observedDuration = source.metrics.totalDurationMs;
  const simulatedDuration = application.simulated.metrics.totalDurationMs;
  const result = {
    id: `${source.id}--${scenario.id}`.slice(0, 240),
    scenario,
    sourceInvestigationId: source.id,
    observed: source,
    simulated: application.simulated,
    changes: application.changes,
    assumptions: application.assumptions,
    metricDecisions: application.metricDecisions,
    unavailableMetrics: application.metricDecisions
      .filter((metric) => metric.policy === "unavailable")
      .map((metric) => metric.metric),
    resolvedFindingIds: application.resolvedFindingIds,
    simulatedFindings: application.simulated.findings.filter(
      (finding) =>
        finding.simulation?.state === "added" || finding.simulation?.state === "modified",
    ),
    summary: {
      title: scenario.title,
      description: application.description,
      reliability: application.reliability,
      changedStageCount: changedStageIds.size,
      durationDeltaMs: simulatedDuration - observedDuration,
    },
    generatedAt: scenario.createdAt,
    engineVersion: COUNTERFACTUAL_ENGINE_VERSION,
    label: SIMULATION_LABEL,
  };
  return counterfactualResultSchema.parse(result);
}
