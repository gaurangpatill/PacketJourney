import type { AiDiagnosisDraft } from "../../features/investigation/aiSchema";
import type { Investigation } from "../../features/investigation/schema";
import { relevantEvidenceForIntent, type selectInvestigationEvidence } from "./evidenceSelection";

const DIRECT_STATUS_QUESTION = /\b(?:health|healthy|valid|correct|secure|safe|status|okay|ok)\b/i;
const DIRECT_STATUS_INTENTS = new Set(["dns", "tls", "cache", "redirect", "security"]);
const severityRank = { info: 0, low: 1, medium: 2, high: 3 } as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function tlsStatusDraft(investigation: Investigation): AiDiagnosisDraft | undefined {
  const stages = investigation.stages.filter((stage) => stage.type === "tls");
  if (stages.length === 0) return undefined;

  const observations = stages.map((stage) => {
    const byLabel = (label: string) => stage.evidence.find((item) => item.label === label);
    const certificate = byLabel("Normalized certificate");
    const validity = byLabel("Certificate validity");
    const coverage = byLabel("Hostname coverage");
    const error = byLabel("Certificate inspection error");
    const certificateValue = record(certificate?.value);
    const validityValue = record(validity?.value);
    const coverageValue = record(coverage?.value);
    return {
      stage,
      certificate,
      validity,
      coverage,
      error,
      hostname:
        typeof certificateValue?.requestedHostname === "string"
          ? certificateValue.requestedHostname
          : stage.title.replace(/^Certificate for\s+/i, ""),
      observationKind: certificateValue?.observationKind,
      validityStatus: validityValue?.status,
      validUntil: validityValue?.validUntil,
      covered: coverageValue?.covered,
    };
  });
  if (!observations.some((item) => item.certificate || item.error)) return undefined;

  const references: AiDiagnosisDraft["evidenceReferences"] = [];
  const cite = (
    item: (typeof observations)[number],
    evidence: (typeof item)["certificate"],
    claim: string,
  ) => {
    if (!evidence || references.some((reference) => reference.evidenceId === evidence.id)) return;
    references.push({ evidenceId: evidence.id, stageId: item.stage.id, claim });
  };

  const servedPeers = observations.filter((item) => item.observationKind === "served-peer");
  const transparency = observations.filter(
    (item) => item.observationKind === "certificate-transparency",
  );
  const allServedPeersHealthy =
    servedPeers.length === observations.length &&
    servedPeers.every((item) => item.validityStatus === "valid" && item.covered === true);

  for (const item of observations) {
    if (item.validity) {
      const validityStatus =
        typeof item.validityStatus === "string" ? item.validityStatus : "unavailable";
      cite(
        item,
        item.validity,
        `The independently collected certificate validity for ${item.hostname} was ${validityStatus}${typeof item.validUntil === "string" ? ` through ${item.validUntil}` : ""}.`,
      );
    }
    if (item.coverage) {
      cite(
        item,
        item.coverage,
        `Deterministic hostname matching reported ${item.covered === true ? "coverage" : item.covered === false ? "no coverage" : "unavailable coverage"} for ${item.hostname}.`,
      );
    }
    if (item.observationKind === "certificate-transparency") {
      cite(
        item,
        item.certificate,
        `Certificate Transparency contained issuance evidence for ${item.hostname}; this was not a served-certificate observation.`,
      );
    }
    if (item.error) {
      cite(
        item,
        item.error,
        `The independent peer-certificate inspection for ${item.hostname} reported an error.`,
      );
    }
  }
  if (references.length === 0) return undefined;

  const emphasizedStageIds = [...new Set(references.map((item) => item.stageId))];
  const graphInstructions = {
    emphasizeStageIds: emphasizedStageIds,
    emphasizeEvidenceIds: references.map((item) => item.evidenceId),
    dimStageIds: [],
    selectedStageId: emphasizedStageIds[0],
    openPanel: "evidence" as const,
  };

  if (allServedPeersHealthy) {
    return {
      summary:
        "The independently observed certificate evidence is currently valid and covers each requested hostname.",
      answer:
        "Packet Journey's independent peer-certificate probe found valid dates and matching hostname coverage for every inspected HTTPS hostname. This supports the collected certificate evidence, but the Worker fetch API still does not expose the certificate selected in its own HTTP session.",
      confidence: 0.95,
      conclusionType: "supported",
      relatedFindings: [],
      prioritizedActions: [],
      evidenceReferences: references.slice(0, 8),
      technicalReferences: [],
      uncertainties: [
        {
          statement: "The exact certificate used by Worker fetch remains unobserved.",
          reason: "The certificate probe is independent of the outbound Worker fetch connection.",
        },
      ],
      followUpQuestions: [],
      graphInstructions,
    };
  }

  const failedProbeCount = observations.filter((item) => item.error).length;
  const ctHostnames = transparency.map((item) => item.hostname).join(", ");
  return {
    summary:
      "Certificate issuance evidence was collected, but the currently served certificate could not be fully verified.",
    answer: `${transparency.length > 0 ? `Certificate Transparency contained current issuance evidence for ${ctHostnames}. ` : ""}${failedProbeCount > 0 ? `The independent peer-certificate probe failed for ${failedProbeCount} inspected hostname${failedProbeCount === 1 ? "" : "s"}, so Packet Journey cannot confirm the certificate currently served there. ` : ""}No collected evidence establishes an expired certificate or hostname mismatch, but overall served-certificate health remains inconclusive.`,
    confidence: 0.9,
    conclusionType: "inconclusive",
    relatedFindings: [],
    prioritizedActions: [
      {
        priority: 1,
        title: "Verify the served certificate from an independent client",
        rationale:
          "Retry the peer inspection or use a separate TLS client to confirm the active certificate chain, validity, and hostname coverage.",
        evidenceIds: references.map((item) => item.evidenceId).slice(0, 8),
        expectedImpact: "unknown",
      },
    ],
    evidenceReferences: references.slice(0, 8),
    technicalReferences: [],
    uncertainties: [
      {
        statement: "The certificate currently served to the Worker HTTP request is unknown.",
        reason:
          "Certificate Transparency records issuance, while the independent live peer probe did not complete.",
        missingEvidence: [
          "A successful served-peer certificate observation for each HTTPS hostname",
        ],
      },
    ],
    followUpQuestions: [],
    graphInstructions,
  };
}

export function deterministicStatusDraft(input: {
  question: string;
  context: ReturnType<typeof selectInvestigationEvidence>;
  investigation: Investigation;
}): AiDiagnosisDraft | undefined {
  if (!DIRECT_STATUS_QUESTION.test(input.question)) return undefined;
  if (!DIRECT_STATUS_INTENTS.has(input.context.intent)) return undefined;
  const relevant = relevantEvidenceForIntent(input.context);
  if (relevant.length === 0) return undefined;

  const evidenceToStage = new Map(
    input.investigation.stages.flatMap((stage) =>
      stage.evidence.map((item) => [item.id, stage.id] as const),
    ),
  );
  const relevantIds = new Set(relevant.map((item) => item.id));
  const finding = [...input.investigation.findings]
    .filter(
      (item) => item.severity !== "info" && item.evidenceIds.some((id) => relevantIds.has(id)),
    )
    .sort(
      (left, right) =>
        severityRank[right.severity] - severityRank[left.severity] ||
        right.confidence - left.confidence,
    )[0];

  if (!finding && input.context.intent === "tls") {
    const tlsDraft = tlsStatusDraft(input.investigation);
    if (tlsDraft) return tlsDraft;
  }

  const citedEvidence = (
    finding
      ? finding.evidenceIds.flatMap((id) => {
          const selected = relevant.find((item) => item.id === id);
          return selected ? [selected] : [];
        })
      : relevant
  ).slice(0, 3);
  const evidenceReferences = citedEvidence.flatMap((item) => {
    const stageId = evidenceToStage.get(item.id);
    return stageId
      ? [
          {
            evidenceId: item.id,
            stageId,
            claim: `The investigation collected ${item.label}.`,
          },
        ]
      : [];
  });
  if (evidenceReferences.length === 0) return undefined;
  const emphasizedStageIds = [...new Set(evidenceReferences.map((item) => item.stageId))];

  if (finding) {
    return {
      summary: finding.title,
      answer: `${finding.explanation} This is a deterministic finding from the collected evidence, not a claim about unobserved protocol behavior.`,
      confidence: finding.confidence,
      conclusionType: "supported",
      primaryFinding: {
        title: finding.title,
        explanation: finding.explanation,
        category: finding.category,
        severity: finding.severity,
        confidence: finding.confidence,
        evidenceIds: evidenceReferences.map((item) => item.evidenceId),
        deterministicFindingIds: [finding.id],
      },
      relatedFindings: [],
      prioritizedActions: finding.recommendation
        ? [
            {
              priority: 1,
              title: "Review the deterministic recommendation",
              rationale: finding.recommendation.slice(0, 900),
              evidenceIds: evidenceReferences.map((item) => item.evidenceId),
              expectedImpact: finding.severity === "high" ? "high" : "unknown",
            },
          ]
        : [],
      evidenceReferences,
      technicalReferences: [],
      uncertainties: [
        {
          statement: "This status applies only to the evidence collected in this run.",
          reason: citedEvidence[0]?.limitation ?? "Unobserved protocol behavior remains unknown.",
        },
      ],
      followUpQuestions: [],
      graphInstructions: {
        emphasizeStageIds: emphasizedStageIds,
        emphasizeEvidenceIds: evidenceReferences.map((item) => item.evidenceId),
        dimStageIds: [],
        selectedStageId: emphasizedStageIds[0],
        openPanel: "evidence",
      },
    };
  }

  const subject = input.context.intent === "tls" ? "certificate" : input.context.intent;
  return {
    summary: `No deterministic ${subject} problem was recorded, but the available evidence does not establish overall health.`,
    answer: `Packet Journey did not record a deterministic ${subject} failure in the collected evidence. This bounded result does not prove that unobserved protocol behavior is healthy or secure.`,
    confidence: 0.45,
    conclusionType: "inconclusive",
    relatedFindings: [],
    prioritizedActions: [],
    evidenceReferences,
    technicalReferences: [],
    uncertainties: [
      {
        statement: `Overall ${subject} health remains inconclusive.`,
        reason:
          citedEvidence.find((item) => item.limitation)?.limitation ??
          "The investigation cannot verify behavior it did not directly observe.",
      },
    ],
    followUpQuestions: [],
    graphInstructions: {
      emphasizeStageIds: emphasizedStageIds,
      emphasizeEvidenceIds: evidenceReferences.map((item) => item.evidenceId),
      dimStageIds: [],
      selectedStageId: emphasizedStageIds[0],
      openPanel: "evidence",
    },
  };
}
