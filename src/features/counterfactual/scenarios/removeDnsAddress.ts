import { SimulationBuilder, sequentialDurationThrough, stageEvidenceIds } from "../builder";
import type { CounterfactualScenario } from "../schemas";
import type { CounterfactualRule } from "../types";
import { CounterfactualError } from "../types";

type Scenario = Extract<CounterfactualScenario, { type: "remove-dns-address" }>;

const ADDRESS_LABEL = /(^|\b)(a|aaaa|address|addresses|resolved address)(\b|$)/i;

export const removeDnsAddressRule: CounterfactualRule<Scenario> = {
  type: "remove-dns-address",
  ruleId: "dns.address-remove.v1",
  version: 1,
  apply(source, scenario) {
    const builder = new SimulationBuilder(source, scenario, this.ruleId);
    const stage = builder.stage(scenario.targetStageId, "dns");
    const addresses = stage.evidence.filter((item) => ADDRESS_LABEL.test(item.label));
    if (!addresses.length && !stage.evidence.length) {
      throw new CounterfactualError(
        "missing_evidence",
        "A DNS stage with address evidence is required.",
      );
    }
    for (const evidence of addresses) {
      const observedValue = evidence.value;
      evidence.value = { state: "removed by simulation", observedValuePreservedInComparison: true };
      evidence.simulation = builder.metadata("modified");
      builder.record({
        targetType: "evidence",
        targetId: evidence.id,
        operation: "modified",
        field: "value",
        observedValue,
        simulatedValue: evidence.value,
        reason: "The rule disables terminal public A/AAAA address evidence in the simulated copy.",
        sourceEvidenceIds: [evidence.id],
      });
    }
    stage.status = "error";
    stage.title = "Simulated DNS address failure";
    stage.shortTitle = "DNS failure";
    stage.description =
      "SIMULATED · NOT MEASURED. No usable A or AAAA address is available in this scenario.";
    stage.simulation = builder.metadata("modified");
    const evidenceId = builder.addEvidence(
      stage,
      "dns-address-missing",
      "Simulated DNS availability",
      {
        usableAddressCount: 0,
        resolverSpecificBehavior: "unavailable",
      },
    );
    builder.record({
      targetType: "stage",
      targetId: stage.id,
      operation: "modified",
      field: "status",
      observedValue: source.stages.find((item) => item.id === stage.id)?.status,
      simulatedValue: "error",
      reason: "The registered availability rule introduces a no-address DNS failure.",
      sourceEvidenceIds: stageEvidenceIds(stage).filter((id) => id !== evidenceId),
    });
    builder.terminateAfter(
      stage,
      "Without a usable simulated address, TLS, HTTP, cache, and browser stages are unreachable.",
    );
    builder.recalculateMetric(
      "totalDurationMs",
      sequentialDurationThrough(source, stage.id),
      "Uses only observed stage durations through the simulated DNS termination point.",
    );
    for (const metric of [
      "tlsMs",
      "timeToFirstByteMs",
      "firstContentfulPaintMs",
      "largestContentfulPaintMs",
      "domContentLoadedMs",
      "loadEventMs",
      "browserDurationMs",
      "transferredBytes",
      "requestCount",
      "thirdPartyCount",
    ] as const) {
      builder.unavailableMetric(
        metric,
        "The simulated journey terminates before this later measurement.",
      );
    }
    builder.addFinding({
      id: `sim-${scenario.id}-dns-unavailable`,
      severity: "high",
      category: "dns",
      title: "Simulated DNS address removal prevents connection",
      explanation:
        "The scenario supplies no usable A or AAAA result, so later connection stages are unreachable. Resolver caching and fallback are not modeled.",
      evidenceIds: [evidenceId],
      recommendation: "Restore a usable public address record and validate resolution.",
      confidence: 1,
    });
    builder.assume(
      "No resolver cache, alternate address family, or fallback supplies a usable address.",
      "availability",
      "high",
    );
    return builder.finish(
      "The simulated active journey terminates at DNS; later observed stages remain visible only as unreachable comparison context.",
      "bounded",
    );
  },
};
