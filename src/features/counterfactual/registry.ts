import { enableEdgeCacheRule } from "./scenarios/enableEdgeCache";
import { expireCertificateRule } from "./scenarios/expireCertificate";
import { reduceJavascriptRule } from "./scenarios/reduceJavascript";
import { reduceOriginLatencyRule } from "./scenarios/reduceOriginLatency";
import { removeDnsAddressRule } from "./scenarios/removeDnsAddress";
import { removeRedirectsRule } from "./scenarios/removeRedirects";
import { removeThirdPartyRule } from "./scenarios/removeThirdParty";
import { resolveCriticalResourceRule } from "./scenarios/resolveCriticalResource";
import type { CounterfactualScenario, CounterfactualScenarioType } from "./schemas";
import type { CounterfactualRule, RuleApplication } from "./types";
import type { Investigation } from "../investigation/schema";
import { CounterfactualError } from "./types";

export interface RegisteredCounterfactualRule {
  type: CounterfactualScenarioType;
  ruleId: string;
  version: number;
  apply(source: Investigation, scenario: CounterfactualScenario): RuleApplication;
}

function register<T extends CounterfactualScenario>(
  rule: CounterfactualRule<T>,
): RegisteredCounterfactualRule {
  return {
    type: rule.type,
    ruleId: rule.ruleId,
    version: rule.version,
    apply(source, scenario) {
      if (scenario.type !== rule.type) {
        throw new CounterfactualError(
          "invalid_scenario",
          `Rule ${rule.ruleId} cannot run ${scenario.type}.`,
        );
      }
      return rule.apply(source, scenario as T);
    },
  };
}

const rules = [
  register(removeRedirectsRule),
  register(enableEdgeCacheRule),
  register(reduceOriginLatencyRule),
  register(reduceJavascriptRule),
  register(removeThirdPartyRule),
  register(resolveCriticalResourceRule),
  register(expireCertificateRule),
  register(removeDnsAddressRule),
];

export const counterfactualRuleRegistry: ReadonlyMap<
  CounterfactualScenarioType,
  RegisteredCounterfactualRule
> = new Map(rules.map((rule) => [rule.type, rule]));

export function getCounterfactualRule(type: CounterfactualScenarioType) {
  const rule = counterfactualRuleRegistry.get(type);
  if (!rule)
    throw new CounterfactualError(
      "unsupported_transformation",
      `No registered rule handles ${type}.`,
    );
  return rule;
}
