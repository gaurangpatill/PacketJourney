import { SimulationBuilder, sequentialDurationThrough, stageEvidenceIds } from "../builder";
import type { CounterfactualScenario } from "../schemas";
import type { CounterfactualRule } from "../types";
import { CounterfactualError } from "../types";

type Scenario = Extract<CounterfactualScenario, { type: "expire-certificate" }>;

export const expireCertificateRule: CounterfactualRule<Scenario> = {
  type: "expire-certificate",
  ruleId: "tls.expire.v1",
  version: 1,
  apply(source, scenario) {
    const builder = new SimulationBuilder(source, scenario, this.ruleId);
    const stage = builder.stage(scenario.targetStageId, "tls");
    if (!stage.evidence.length) {
      throw new CounterfactualError(
        "missing_evidence",
        "A collected TLS or certificate stage is required.",
      );
    }
    stage.status = "error";
    stage.title = "Simulated expired certificate";
    stage.shortTitle = "TLS expired";
    stage.description =
      "SIMULATED · NOT MEASURED. Clients that enforce certificate validity may stop before HTTP.";
    stage.simulation = builder.metadata("modified");
    const evidenceId = builder.addEvidence(
      stage,
      "certificate-expired",
      "Simulated certificate validity",
      {
        state: "expired",
        connectionAllowed: false,
        exactFetchSessionCertificate: "unavailable",
      },
    );
    builder.record({
      targetType: "stage",
      targetId: stage.id,
      operation: "modified",
      field: "status",
      observedValue: source.stages.find((item) => item.id === stage.id)?.status,
      simulatedValue: "error",
      reason: "The registered failure-introduction rule marks certificate validity expired.",
      sourceEvidenceIds: stageEvidenceIds(stage).filter((id) => id !== evidenceId),
    });
    builder.terminateAfter(
      stage,
      "The simulated TLS validity failure terminates the active path before HTTP.",
    );
    builder.recalculateMetric(
      "totalDurationMs",
      sequentialDurationThrough(source, stage.id),
      "Uses only observed stage durations through the simulated TLS termination point.",
    );
    for (const metric of [
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
        "The simulated journey terminates before the HTTP/browser measurement represented by this metric.",
      );
    }
    builder.addFinding({
      id: `sim-${scenario.id}-certificate-expired`,
      severity: "high",
      category: "tls",
      title: "Simulated certificate expiration blocks the journey",
      explanation:
        "This counterfactual assumes certificate-validating clients reject the connection before HTTP. It is not evidence that the observed certificate is expired.",
      evidenceIds: [evidenceId],
      recommendation: "Renew and deploy a valid certificate before expiration.",
      confidence: 1,
    });
    builder.assume(
      "The connecting client enforces Web PKI certificate validity and rejects an expired certificate.",
      "security",
      "high",
    );
    builder.assume(
      "Independent certificate evidence is not asserted to be the exact certificate used by Worker fetch.",
      "security",
      "high",
    );
    return builder.finish(
      "The simulated active journey terminates at TLS; all later observed stages remain historical comparison context and are marked unreachable.",
      "bounded",
    );
  },
};
