import { SimulationBuilder } from "../builder";
import { resourceEvidence } from "../resources";
import type { CounterfactualScenario } from "../schemas";
import type { CounterfactualRule } from "../types";
import { CounterfactualError } from "../types";

type Scenario = Extract<CounterfactualScenario, { type: "resolve-critical-resource" }>;
const CRITICAL_TYPES = new Set(["document", "script", "stylesheet"]);

export const resolveCriticalResourceRule: CounterfactualRule<Scenario> = {
  type: "resolve-critical-resource",
  ruleId: "resource.failure-resolve.v1",
  version: 1,
  apply(source, scenario) {
    const builder = new SimulationBuilder(source, scenario, this.ruleId);
    const collections = resourceEvidence(builder.draft);
    const occurrence = collections
      .flatMap((collection) =>
        collection.resources.map((resource) => ({ ...collection, resource })),
      )
      .find(({ resource }) => resource.id === scenario.targetResourceId);
    if (!occurrence?.resource.failed) {
      throw new CounterfactualError(
        "missing_evidence",
        "The target must be a verified failed browser resource.",
      );
    }
    if (!CRITICAL_TYPES.has(occurrence.resource.type)) {
      throw new CounterfactualError(
        "ineligible_scenario",
        "Only failed document, script, or stylesheet resources are eligible.",
      );
    }
    for (const collection of collections) {
      const next = collection.resources.map((resource) => {
        if (resource.id !== scenario.targetResourceId) return resource;
        const simulated = { ...resource, failed: false, simulatedSuccess: true };
        delete simulated.failureReason;
        delete simulated.status;
        delete simulated.transferSize;
        return simulated;
      });
      if (next.some((resource) => resource.id === scenario.targetResourceId)) {
        collection.evidence.value = next;
        collection.evidence.simulation = builder.metadata("modified");
        collection.stage.simulation = builder.metadata("modified");
      }
    }
    const evidenceId = builder.addEvidence(
      occurrence.stage,
      `resource-${scenario.targetResourceId}`,
      "Simulated critical resource recovery",
      {
        resourceId: scenario.targetResourceId,
        success: true,
        responseStatus: "unavailable",
        transferSize: "unavailable",
        durationMs: "unavailable",
      },
    );
    builder.record({
      targetType: "resource",
      targetId: scenario.targetResourceId,
      operation: "modified",
      field: "failed",
      observedValue: true,
      simulatedValue: false,
      reason:
        "The selected verified critical failure is changed to simulated success without fabricating response values.",
      sourceEvidenceIds: [occurrence.evidence.id],
    });
    const remainingCriticalFailures = resourceEvidence(builder.draft).some(({ resources }) =>
      resources.some((resource) => resource.failed && CRITICAL_TYPES.has(resource.type)),
    );
    if (!remainingCriticalFailures) {
      builder.resolveFindings(
        (finding) => finding.id === "finding-browser-failed-critical-resource",
        "No verified critical failure remains in the simulated resource collection.",
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
        "Resource recovery was not executed; visual and functional recovery cannot be measured.",
      );
    }
    builder.assume(
      "The resource can load successfully without changing its requested role or application behavior.",
      "resource",
      "high",
    );
    builder.assume(
      "Response status, transfer size, and duration remain unknown.",
      "browser",
      "high",
    );
    builder.addFinding({
      id: `sim-${scenario.id}-resource-recovered`,
      severity: "info",
      category: "frontend",
      title: "Critical resource marked successful in simulation",
      explanation:
        "The failed flag is removed only for comparison. No response status, bytes, timing, or user-visible recovery was measured.",
      evidenceIds: [evidenceId],
      confidence: 1,
    });
    return builder.finish(
      "The selected critical resource is marked successful, while all unknown response and rendering effects remain unavailable.",
      "low",
    );
  },
};
