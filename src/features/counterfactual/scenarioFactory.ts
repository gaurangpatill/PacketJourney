import type { Investigation } from "../investigation/schema";
import { counterfactualScenarioSchema, type CounterfactualScenario } from "./schemas";
import type { CounterfactualSuggestion } from "./suggestions";

export interface ScenarioInputs {
  durationMs?: number;
  reductionPercent?: number;
  selectedTargetId?: string;
}

export function createScenario(
  investigation: Investigation,
  suggestion: CounterfactualSuggestion,
  inputs: ScenarioInputs,
  metadata: { id: string; createdAt: string },
): CounterfactualScenario {
  const base = {
    id: metadata.id,
    title: suggestion.title,
    description: suggestion.description,
    createdAt: metadata.createdAt,
    source: "suggested" as const,
  };
  const target = inputs.selectedTargetId ?? suggestion.targetStageIds[0];
  let scenario: unknown;
  if (suggestion.type === "remove-redirects")
    scenario = { ...base, type: suggestion.type, targetStageIds: suggestion.targetStageIds };
  if (suggestion.type === "enable-edge-cache")
    scenario = {
      ...base,
      type: suggestion.type,
      targetCacheStageId: suggestion.targetStageIds[0],
      targetOriginStageId: suggestion.targetStageIds[1],
    };
  if (suggestion.type === "reduce-origin-latency") {
    const stage = investigation.stages.find((item) => item.id === target);
    scenario = {
      ...base,
      type: suggestion.type,
      targetStageId: target,
      targetDurationMs: inputs.durationMs ?? Math.max(0, Math.round((stage?.durationMs ?? 0) / 2)),
    };
  }
  if (suggestion.type === "reduce-javascript")
    scenario = {
      ...base,
      type: suggestion.type,
      ...(target ? { targetStageId: target } : {}),
      reductionPercent: inputs.reductionPercent ?? 50,
    };
  if (suggestion.type === "remove-third-party")
    scenario = { ...base, type: suggestion.type, targetStageId: target };
  if (suggestion.type === "resolve-critical-resource")
    scenario = {
      ...base,
      type: suggestion.type,
      targetResourceId: inputs.selectedTargetId ?? suggestion.targetResourceIds?.[0],
    };
  if (suggestion.type === "expire-certificate")
    scenario = { ...base, type: suggestion.type, targetStageId: target };
  if (suggestion.type === "remove-dns-address")
    scenario = { ...base, type: suggestion.type, targetStageId: target };
  return counterfactualScenarioSchema.parse(scenario);
}
