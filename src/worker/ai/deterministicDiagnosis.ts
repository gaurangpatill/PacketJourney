import type { AiDiagnosisDraft } from "../../features/investigation/aiSchema";
import type { Investigation } from "../../features/investigation/schema";
import { relevantEvidenceForIntent, type selectInvestigationEvidence } from "./evidenceSelection";

const DIRECT_STATUS_QUESTION = /\b(?:health|healthy|valid|correct|secure|safe|status|okay|ok)\b/i;
const DIRECT_STATUS_INTENTS = new Set(["dns", "tls", "cache", "redirect", "security"]);
const severityRank = { info: 0, low: 1, medium: 2, high: 3 } as const;

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
