import type { AiDiagnosisDraft } from "../../features/investigation/aiSchema";
import type { Finding, Investigation } from "../../features/investigation/schema";
import type { InvestigationEvidenceContext, InvestigationIntent } from "./types";

const severityRank: Record<Finding["severity"], number> = {
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

const intentFindingCategories: Record<InvestigationIntent, Set<Finding["category"]>> = {
  performance: new Set(["redirect", "cache", "origin", "frontend", "third-party"]),
  cache: new Set(["cache", "origin"]),
  dns: new Set(["dns"]),
  tls: new Set(["tls"]),
  redirect: new Set(["redirect"]),
  browser: new Set(["frontend", "third-party"]),
  "third-party": new Set(["third-party", "frontend"]),
  security: new Set(["security", "tls"]),
  broad: new Set([
    "dns",
    "tls",
    "redirect",
    "cache",
    "origin",
    "frontend",
    "security",
    "third-party",
  ]),
};

function rankedFindings(investigation: Investigation, intent: InvestigationIntent) {
  const allowed = intentFindingCategories[intent];
  return investigation.findings
    .filter((finding) => finding.severity !== "info" && allowed.has(finding.category))
    .sort(
      (left, right) =>
        severityRank[right.severity] - severityRank[left.severity] ||
        right.confidence - left.confidence ||
        left.id.localeCompare(right.id),
    )
    .slice(0, 2);
}

export function evidenceGuardDraft(input: {
  investigation: Investigation;
  context: InvestigationEvidenceContext;
  reason: string;
}): AiDiagnosisDraft {
  const evidenceToStage = new Map(
    input.investigation.stages.flatMap((stage) =>
      stage.evidence.map((item) => [item.id, stage.id] as const),
    ),
  );
  const findings = rankedFindings(input.investigation, input.context.intent);
  const counterfactualReferences = input.context.counterfactual
    ? [
        ...input.context.counterfactual.changes.slice(0, 2).map((change) => ({
          type: "change" as const,
          id: change.id,
          claim:
            "This result includes a change produced by the registered deterministic simulation rule.",
        })),
        ...input.context.counterfactual.assumptions.slice(0, 1).map((assumption) => ({
          type: "assumption" as const,
          id: assumption.id,
          claim: "This result remains bounded by a recorded counterfactual assumption.",
        })),
      ]
    : undefined;

  if (findings.length > 0) {
    const primary = findings[0]!;
    const related = findings.slice(1);
    const findingEvidenceIds = [
      ...new Set(findings.flatMap((finding) => finding.evidenceIds)),
    ].slice(0, 12);
    const evidenceReferences = findingEvidenceIds.flatMap((evidenceId) => {
      const stageId = evidenceToStage.get(evidenceId);
      return stageId
        ? [
            {
              evidenceId,
              stageId,
              claim: `This collected evidence supports the deterministic finding "${findings.find((finding) => finding.evidenceIds.includes(evidenceId))?.title ?? primary.title}."`,
            },
          ]
        : [];
    });
    const emphasizedStageIds = [...new Set(evidenceReferences.map((item) => item.stageId))];
    const citedEvidenceIds = new Set(evidenceReferences.map((item) => item.evidenceId));

    const performance = input.context.intent === "performance";
    return {
      summary: performance
        ? `The strongest observed slowdown candidate is ${primary.title.toLowerCase()}.`
        : `The strongest evidence-backed finding is ${primary.title.toLowerCase()}.`,
      answer: `${primary.explanation}${related[0] ? ` The investigation also recorded ${related[0].title.toLowerCase()}.` : ""} ${performance ? "These are evidence-backed candidates, not proof of isolated causal impact." : "This conclusion is limited to the evidence collected in this run."}`,
      confidence: Math.min(0.78, Math.max(0.55, primary.confidence * 0.8)),
      conclusionType: "likely",
      relatedFindings: [],
      prioritizedActions: primary.recommendation
        ? [
            {
              priority: 1,
              title: `Investigate ${primary.title.toLowerCase()}`,
              rationale: primary.recommendation,
              evidenceIds: primary.evidenceIds.filter((id) => citedEvidenceIds.has(id)),
              expectedImpact: primary.severity === "high" ? "high" : "unknown",
            },
          ]
        : [],
      evidenceReferences,
      technicalReferences: [],
      ...(counterfactualReferences ? { counterfactualReferences } : {}),
      uncertainties: [
        {
          statement: "The relative contribution of each observed signal remains uncertain.",
          reason: `${input.reason} Packet Journey therefore ranked deterministic findings only; this single run did not isolate causation.`,
        },
      ],
      followUpQuestions: ["Which cited slowdown candidate should I inspect in detail?"],
      graphInstructions: {
        emphasizeStageIds: emphasizedStageIds,
        emphasizeEvidenceIds: evidenceReferences.map((item) => item.evidenceId),
        dimStageIds: [],
        selectedStageId: emphasizedStageIds[0],
        openPanel: "findings",
      },
    };
  }

  const evidence = [...input.context.evidence]
    .sort((left, right) => {
      const signal = (label: string) =>
        /resource summary|browser navigation|timing|redirect|cache|response|failed|console/i.test(
          label,
        )
          ? 1
          : 0;
      return signal(right.label) - signal(left.label) || left.id.localeCompare(right.id);
    })
    .slice(0, 3);
  const evidenceReferences = evidence.map((item) => ({
    evidenceId: item.id,
    stageId: item.stageId,
    claim: `The investigation collected ${item.label} from ${item.source}.`,
  }));
  const emphasizedStageIds = [...new Set(evidence.map((item) => item.stageId))];

  return {
    summary:
      "The investigation collected relevant signals but no deterministic finding crossed its rule thresholds.",
    answer: `Available evidence includes ${evidence.map((item) => item.label.toLowerCase()).join(", ")}. Packet Journey cannot support a stronger conclusion without additional or repeated measurements.`,
    confidence: 0.35,
    conclusionType: "inconclusive",
    relatedFindings: [],
    prioritizedActions: [],
    evidenceReferences,
    technicalReferences: [],
    ...(counterfactualReferences ? { counterfactualReferences } : {}),
    uncertainties: [
      {
        statement: "No evidence-backed bottleneck can be ranked from this run.",
        reason: `${input.reason} No deterministic performance rule supplied a stronger conclusion.`,
        missingEvidence: ["Repeated measurements or a directly observed bottleneck"],
      },
    ],
    followUpQuestions: ["Can I inspect the browser resource and timing evidence separately?"],
    graphInstructions: {
      emphasizeStageIds: emphasizedStageIds,
      emphasizeEvidenceIds: evidence.map((item) => item.id),
      dimStageIds: [],
      selectedStageId: emphasizedStageIds[0],
      openPanel: "evidence",
    },
  };
}

const DIRECT_PERFORMANCE_QUESTION =
  /\b(?:what (?:could|might) slow|what is (?:most )?likely delaying|likely bottleneck|why (?:is|does).{0,40}slow|performance bottleneck)\b/i;

export function deterministicPerformanceDraft(input: {
  question: string;
  investigation: Investigation;
  context: InvestigationEvidenceContext;
}): AiDiagnosisDraft | undefined {
  if (input.context.intent !== "performance") return undefined;
  if (!DIRECT_PERFORMANCE_QUESTION.test(input.question)) return undefined;
  if (rankedFindings(input.investigation, input.context.intent).length === 0) return undefined;
  return evidenceGuardDraft({
    investigation: input.investigation,
    context: input.context,
    reason: "Packet Journey answered this direct ranking question from deterministic findings.",
  });
}
