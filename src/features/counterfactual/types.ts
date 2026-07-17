import type { Investigation } from "../investigation/schema";
import type {
  CounterfactualAssumption,
  CounterfactualChange,
  CounterfactualScenario,
  CounterfactualScenarioType,
  SimulatedMetricDecision,
} from "./schemas";

export class CounterfactualError extends Error {
  constructor(
    readonly code:
      | "invalid_scenario"
      | "ineligible_scenario"
      | "missing_evidence"
      | "invalid_reference"
      | "unsupported_transformation",
    message: string,
  ) {
    super(message);
    this.name = "CounterfactualError";
  }
}

export interface RuleApplication {
  simulated: Investigation;
  changes: CounterfactualChange[];
  assumptions: CounterfactualAssumption[];
  metricDecisions: SimulatedMetricDecision[];
  resolvedFindingIds: string[];
  reliability: "high" | "bounded" | "low";
  description: string;
}

export interface CounterfactualRule<T extends CounterfactualScenario = CounterfactualScenario> {
  readonly type: CounterfactualScenarioType;
  readonly ruleId: string;
  readonly version: number;
  apply(source: Investigation, scenario: T): RuleApplication;
}
