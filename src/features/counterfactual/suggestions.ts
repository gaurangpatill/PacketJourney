import type { Investigation, JourneyStage } from "../investigation/schema";
import { resourceEvidence } from "./resources";
import type { CounterfactualScenarioType } from "./schemas";

export interface CounterfactualSuggestion {
  type: CounterfactualScenarioType;
  title: string;
  description: string;
  reason: string;
  targetStageIds: string[];
  targetResourceIds?: string[];
}

function suggestion(
  type: CounterfactualScenarioType,
  title: string,
  description: string,
  reason: string,
  stages: JourneyStage[],
  targetResourceIds?: string[],
): CounterfactualSuggestion {
  return {
    type,
    title,
    description,
    reason,
    targetStageIds: stages.map((stage) => stage.id),
    ...(targetResourceIds?.length ? { targetResourceIds } : {}),
  };
}

export function suggestCounterfactuals(investigation: Investigation): CounterfactualSuggestion[] {
  if (investigation.simulation) return [];
  const suggestions: CounterfactualSuggestion[] = [];
  const redirects = investigation.stages.filter((stage) => stage.type === "redirect");
  if (redirects.length)
    suggestions.push(
      suggestion(
        "remove-redirects",
        "Remove redirect hops",
        "Remove selected observed redirect stages.",
        `${redirects.length} redirect stage${redirects.length === 1 ? "" : "s"} are present.`,
        redirects,
      ),
    );
  const cache = investigation.stages.find((stage) => stage.type === "cache");
  const origin = investigation.stages.find((stage) => stage.type === "origin");
  if (cache && origin)
    suggestions.push(
      suggestion(
        "enable-edge-cache",
        "Cache HTML at the edge",
        "Serve the document from the existing cache stage and bypass origin.",
        "The observed path includes both cache and origin stages.",
        [cache, origin],
      ),
    );
  if (origin?.durationMs !== undefined)
    suggestions.push(
      suggestion(
        "reduce-origin-latency",
        "Reduce origin duration",
        "Set a smaller deterministic duration for the observed origin stage.",
        `Origin contributes ${origin.durationMs} ms in the observed journey.`,
        [origin],
      ),
    );
  const scriptCollections = resourceEvidence(investigation).filter(({ resources }) =>
    resources.some((resource) => resource.type === "script" && resource.transferSize !== undefined),
  );
  const displayScriptStages = investigation.stages.filter((stage) =>
    stage.evidence.some(
      (evidence) =>
        /resource type/i.test(evidence.label) && /script|javascript/i.test(String(evidence.value)),
    ),
  );
  if (scriptCollections.length || displayScriptStages.length)
    suggestions.push(
      suggestion(
        "reduce-javascript",
        "Reduce JavaScript transfer",
        "Reduce known JavaScript transfer bytes without predicting execution or paint.",
        "Verified script transfer evidence is available.",
        [...scriptCollections.map((item) => item.stage), ...displayScriptStages],
      ),
    );
  for (const stage of investigation.stages.filter((item) => item.type === "third-party")) {
    suggestions.push(
      suggestion(
        "remove-third-party",
        `Remove ${stage.shortTitle}`,
        "Remove this observed third-party dependency group.",
        "A distinct third-party branch exists in the observed graph.",
        [stage],
      ),
    );
  }
  const failedCritical = resourceEvidence(investigation).flatMap(({ resources }) =>
    resources
      .filter(
        (resource) =>
          resource.failed && ["document", "script", "stylesheet"].includes(resource.type),
      )
      .map((resource) => resource.id),
  );
  if (failedCritical.length)
    suggestions.push(
      suggestion(
        "resolve-critical-resource",
        "Resolve a failed critical resource",
        "Mark one verified critical failure successful while leaving unmeasured values unavailable.",
        "A failed document, script, or stylesheet is present.",
        [],
        failedCritical,
      ),
    );
  const tls = investigation.stages.filter((stage) => stage.type === "tls" && stage.evidence.length);
  if (tls.length)
    suggestions.push(
      suggestion(
        "expire-certificate",
        "Expire a certificate",
        "Introduce a simulated certificate validity failure.",
        "Certificate evidence exists for this journey.",
        tls,
      ),
    );
  const dns = investigation.stages.filter((stage) => stage.type === "dns" && stage.evidence.length);
  if (dns.length)
    suggestions.push(
      suggestion(
        "remove-dns-address",
        "Remove DNS address availability",
        "Simulate a DNS result with no usable address.",
        "DNS evidence exists for this journey.",
        dns,
      ),
    );
  return suggestions;
}
