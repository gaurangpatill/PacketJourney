import type { Finding, Investigation, JourneyStage } from "../investigation/schema";
import { investigationSchema } from "../investigation/schema";
import {
  COUNTERFACTUAL_ENGINE_VERSION,
  SIMULATION_LABEL,
  type CounterfactualAssumption,
  type CounterfactualChange,
  type CounterfactualScenario,
  type SimulatedMetricDecision,
  type SimulatedMetricName,
} from "./schemas";
import { CounterfactualError, type RuleApplication } from "./types";

export const METRIC_NAMES: SimulatedMetricName[] = [
  "totalDurationMs",
  "dnsMs",
  "tlsMs",
  "timeToFirstByteMs",
  "firstContentfulPaintMs",
  "domContentLoadedMs",
  "loadEventMs",
  "largestContentfulPaintMs",
  "browserDurationMs",
  "transferredBytes",
  "requestCount",
  "thirdPartyCount",
];

export function stageEvidenceIds(stage: JourneyStage): string[] {
  return stage.evidence.map((item) => item.id);
}

export function isVerifiedStage(stage: JourneyStage): boolean {
  return stage.evidence.some((item) => item.confidence === "verified");
}

export class SimulationBuilder {
  readonly draft: Investigation;
  readonly changes: CounterfactualChange[] = [];
  readonly assumptions: CounterfactualAssumption[] = [];
  readonly resolvedFindingIds: string[] = [];
  private readonly metrics = new Map<SimulatedMetricName, SimulatedMetricDecision>();
  private changeIndex = 0;
  private assumptionIndex = 0;

  constructor(
    readonly source: Investigation,
    readonly scenario: CounterfactualScenario,
    readonly ruleId: string,
  ) {
    this.draft = structuredClone(source);
    this.draft.id = `${source.id}--sim-${scenario.id}`.slice(0, 240);
    this.draft.title = `${source.title} — simulated`;
    this.draft.summary = `${SIMULATION_LABEL}. ${scenario.description}`;
    this.draft.simulation = {
      isSimulated: true,
      sourceInvestigationId: source.id,
      scenarioId: scenario.id,
      ruleId,
      engineVersion: COUNTERFACTUAL_ENGINE_VERSION,
      label: SIMULATION_LABEL,
    };
    for (const stage of this.draft.stages) {
      stage.simulation = this.metadata("unchanged");
    }
    for (const finding of this.draft.findings) {
      finding.simulation = this.metadata("unchanged");
    }
    for (const metric of METRIC_NAMES) {
      const observedValue = source.metrics[metric];
      this.metrics.set(metric, {
        metric,
        policy: observedValue === undefined ? "unavailable" : "unchanged",
        ...(observedValue === undefined ? {} : { observedValue, simulatedValue: observedValue }),
        reason:
          observedValue === undefined
            ? "The observed investigation did not collect this metric."
            : "This rule does not transform this independent observed metric.",
        ruleId,
      });
    }
  }

  metadata(state: "added" | "modified" | "unchanged" | "unreachable") {
    return {
      isSimulated: true as const,
      scenarioId: this.scenario.id,
      ruleId: this.ruleId,
      label: SIMULATION_LABEL,
      state,
    };
  }

  stage(id: string, type?: JourneyStage["type"]): JourneyStage {
    const stage = this.draft.stages.find((candidate) => candidate.id === id);
    if (!stage || (type && stage.type !== type)) {
      throw new CounterfactualError(
        "invalid_reference",
        `Scenario target ${id} is not an eligible ${type ?? "journey"} stage.`,
      );
    }
    return stage;
  }

  record(change: Omit<CounterfactualChange, "id" | "ruleId">): CounterfactualChange {
    const item: CounterfactualChange = {
      ...change,
      id: `${this.scenario.id}-change-${++this.changeIndex}`,
      ruleId: this.ruleId,
    };
    this.changes.push(item);
    return item;
  }

  assume(
    statement: string,
    category: CounterfactualAssumption["category"],
    importance: CounterfactualAssumption["importance"],
  ) {
    this.assumptions.push({
      id: `${this.scenario.id}-assumption-${++this.assumptionIndex}`,
      statement,
      category,
      importance,
    });
  }

  addEvidence(stage: JourneyStage, suffix: string, label: string, value: unknown) {
    const id = `sim-${this.scenario.id}-${suffix}`.slice(0, 160);
    stage.evidence.push({
      id,
      label,
      value,
      source: `Deterministic counterfactual rule ${this.ruleId}`,
      collectedAt: this.scenario.createdAt,
      confidence: "inferred",
      simulation: this.metadata("added"),
    });
    this.record({
      targetType: "evidence",
      targetId: id,
      operation: "added",
      simulatedValue: value,
      reason: `${SIMULATION_LABEL}: ${label}`,
      sourceEvidenceIds: stageEvidenceIds(stage).filter((item) => item !== id),
    });
    return id;
  }

  addFinding(finding: Omit<Finding, "simulation">): Finding {
    const simulated = { ...finding, simulation: this.metadata("added") };
    this.draft.findings.push(simulated);
    this.record({
      targetType: "finding",
      targetId: finding.id,
      operation: "added",
      simulatedValue: finding.title,
      reason: `${SIMULATION_LABEL}: the registered rule introduces this deterministic finding.`,
      sourceEvidenceIds: finding.evidenceIds,
    });
    return simulated;
  }

  resolveFindings(predicate: (finding: Finding) => boolean, reason: string) {
    const removed = this.draft.findings.filter(predicate);
    this.draft.findings = this.draft.findings.filter((finding) => !predicate(finding));
    for (const finding of removed) {
      this.resolvedFindingIds.push(finding.id);
      this.record({
        targetType: "finding",
        targetId: finding.id,
        operation: "removed",
        observedValue: finding.title,
        reason,
        sourceEvidenceIds: finding.evidenceIds,
      });
    }
  }

  recalculateMetric(metric: SimulatedMetricName, value: number, reason: string) {
    const safeValue = Math.max(0, Number.isInteger(value) ? value : Math.round(value * 100) / 100);
    const observedValue = this.source.metrics[metric];
    this.draft.metrics[metric] = safeValue;
    this.metrics.set(metric, {
      metric,
      policy: "recalculated",
      ...(observedValue === undefined ? {} : { observedValue, delta: safeValue - observedValue }),
      simulatedValue: safeValue,
      reason,
      ruleId: this.ruleId,
    });
    this.record({
      targetType: "metric",
      targetId: metric,
      operation: "modified",
      field: metric,
      observedValue,
      simulatedValue: safeValue,
      reason,
      sourceEvidenceIds: [],
    });
  }

  unavailableMetric(metric: SimulatedMetricName, reason: string) {
    const observedValue = this.source.metrics[metric];
    delete this.draft.metrics[metric];
    this.metrics.set(metric, {
      metric,
      policy: "unavailable",
      ...(observedValue === undefined ? {} : { observedValue }),
      reason,
      ruleId: this.ruleId,
    });
    this.record({
      targetType: "metric",
      targetId: metric,
      operation: "unavailable",
      field: metric,
      observedValue,
      reason,
      sourceEvidenceIds: [],
    });
  }

  terminateAfter(stage: JourneyStage, reason: string) {
    const outgoing = [...stage.connections];
    stage.connections = [];
    stage.simulation = this.metadata("modified");
    for (const targetId of outgoing) {
      this.record({
        targetType: "edge",
        targetId: `${stage.id}::${targetId}`,
        operation: "removed",
        reason,
        sourceEvidenceIds: stageEvidenceIds(stage),
      });
    }
    const queue = [...outgoing];
    const visited = new Set<string>();
    while (queue.length) {
      const id = queue.shift();
      if (!id || visited.has(id)) continue;
      visited.add(id);
      const candidate = this.draft.stages.find((item) => item.id === id);
      if (!candidate) continue;
      candidate.simulation = this.metadata("unreachable");
      this.record({
        targetType: "stage",
        targetId: candidate.id,
        operation: "unavailable",
        field: "activePath",
        observedValue: true,
        simulatedValue: false,
        reason,
        sourceEvidenceIds: stageEvidenceIds(candidate),
      });
      queue.push(...candidate.connections);
    }
  }

  finish(description: string, reliability: RuleApplication["reliability"]): RuleApplication {
    const simulated = investigationSchema.parse(this.draft);
    return {
      simulated,
      changes: this.changes,
      assumptions: this.assumptions,
      metricDecisions: METRIC_NAMES.map((name) => this.metrics.get(name)!),
      resolvedFindingIds: this.resolvedFindingIds,
      reliability,
      description,
    };
  }
}

export function sequentialDurationThrough(source: Investigation, terminalId: string): number {
  const incoming = new Set(source.stages.flatMap((stage) => stage.connections));
  let current = source.stages.find((stage) => !incoming.has(stage.id)) ?? source.stages[0];
  let duration = 0;
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    duration += current.durationMs ?? 0;
    if (current.id === terminalId) return duration;
    const nextId = current.connections.find((id) => !visited.has(id));
    current = source.stages.find((stage) => stage.id === nextId);
  }
  return duration;
}
