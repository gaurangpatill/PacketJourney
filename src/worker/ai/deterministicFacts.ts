import type { AiDiagnosisDraft, AiEvidenceReference } from "../../features/investigation/aiSchema";
import type {
  EvidenceItem,
  Investigation,
  JourneyStage,
} from "../../features/investigation/schema";

type IndexedEvidence = { stage: JourneyStage; evidence: EvidenceItem };
type FactKind =
  | "identity"
  | "final-url"
  | "http-status"
  | "redirect-count"
  | "stage-count"
  | "total-duration"
  | "request-count"
  | "third-party-count";

const factQueries: Array<{ kind: FactKind; patterns: RegExp[] }> = [
  {
    kind: "identity",
    patterns: [
      /\b(?:what|which) (?:web)?site (?:are we|is (?:this|the investigation)) (?:tracking|investigating|about)\b/i,
      /\b(?:what|which) (?:web)?site is (?:this|the) investigation about\b/i,
      /\bwhat (?:web)?site is this\b/i,
      /\bwhat (?:are we|is this) (?:tracking|investigating|looking at)\b/i,
      /\b(?:tracked|investigated|requested) (?:web)?site\b/i,
    ],
  },
  {
    kind: "final-url",
    patterns: [
      /\b(?:what|which) (?:is|was) the (?:final|landing|destination) url\b/i,
      /\bwhere did (?:the|this) (?:request|journey|redirect) (?:end|land)\b/i,
    ],
  },
  {
    kind: "http-status",
    patterns: [
      /\b(?:what|which) (?:http )?status(?: code)?\b/i,
      /\bstatus(?: code)? (?:did|was) (?:the )?(?:server|response|request)\b/i,
    ],
  },
  {
    kind: "redirect-count",
    patterns: [/\bhow many redirects?\b/i, /\bredirect count\b/i],
  },
  {
    kind: "stage-count",
    patterns: [/\bhow many (?:journey )?stages?\b/i, /\bstage count\b/i],
  },
  {
    kind: "total-duration",
    patterns: [
      /\bhow long did (?:the|this) (?:investigation|journey|request) take\b/i,
      /\b(?:what|which) (?:is|was) the total (?:duration|time)\b/i,
    ],
  },
  {
    kind: "request-count",
    patterns: [/\bhow many requests?\b/i, /\brequest count\b/i],
  },
  {
    kind: "third-party-count",
    patterns: [
      /\bhow many third[- ]party (?:requests?|services?|domains?)\b/i,
      /\bthird[- ]party count\b/i,
    ],
  },
];

function classifyFactQuestion(question: string): FactKind | undefined {
  return factQueries.find(({ patterns }) => patterns.some((pattern) => pattern.test(question)))
    ?.kind;
}

function evidenceIndex(investigation: Investigation): IndexedEvidence[] {
  return investigation.stages.flatMap((stage) =>
    stage.evidence.map((evidence) => ({ stage, evidence })),
  );
}

function findEvidence(
  investigation: Investigation,
  label: RegExp,
  options: { stageType?: JourneyStage["type"]; last?: boolean } = {},
): IndexedEvidence | undefined {
  const candidates = evidenceIndex(investigation).filter(
    ({ stage, evidence }) =>
      (!options.stageType || stage.type === options.stageType) && label.test(evidence.label),
  );
  return options.last ? candidates.at(-1) : candidates[0];
}

function reference(item: IndexedEvidence | undefined, claim: string): AiEvidenceReference[] {
  return item ? [{ evidenceId: item.evidence.id, stageId: item.stage.id, claim }] : [];
}

function finalUrl(investigation: Investigation): { value: string; evidence?: IndexedEvidence } {
  const observed = findEvidence(investigation, /^Final URL$/i, { last: true });
  if (typeof observed?.evidence.value === "string") {
    return { value: observed.evidence.value, evidence: observed };
  }
  const redirectDestination = findEvidence(investigation, /^(?:Destination|Location)$/i, {
    stageType: "redirect",
    last: true,
  });
  return {
    value:
      typeof redirectDestination?.evidence.value === "string"
        ? redirectDestination.evidence.value
        : investigation.normalizedUrl,
    ...(redirectDestination ? { evidence: redirectDestination } : {}),
  };
}

function baseDraft(input: {
  summary: string;
  answer: string;
  references: AiEvidenceReference[];
  selectedStageId?: string;
}): AiDiagnosisDraft {
  const stageIds = [...new Set(input.references.map((item) => item.stageId))];
  const evidenceIds = input.references.map((item) => item.evidenceId);
  return {
    summary: input.summary,
    answer: input.answer,
    confidence: input.references.length > 0 ? 1 : 0.9,
    conclusionType: "supported",
    relatedFindings: [],
    prioritizedActions: [],
    evidenceReferences: input.references,
    technicalReferences: [],
    uncertainties: [],
    followUpQuestions: [],
    graphInstructions: {
      emphasizeStageIds: stageIds,
      emphasizeEvidenceIds: evidenceIds,
      dimStageIds: [],
      selectedStageId: input.selectedStageId ?? stageIds[0],
      openPanel: input.references.length > 0 ? "evidence" : "none",
    },
  };
}

function identityDraft(investigation: Investigation): AiDiagnosisDraft {
  const directInput = findEvidence(
    investigation,
    /^(?:Submitted|Requested|Request|Normalized)? ?URL$/i,
    { stageType: "input" },
  );
  const firstStage = investigation.stages[0];
  const requested =
    directInput ??
    (firstStage?.evidence[0] ? { stage: firstStage, evidence: firstStage.evidence[0] } : undefined);
  const destination = finalUrl(investigation);
  const hostname = new URL(investigation.normalizedUrl).hostname;
  const changed = destination.value !== investigation.normalizedUrl;
  const references = [
    ...reference(requested, `The canonical investigation input is ${investigation.normalizedUrl}.`),
    ...reference(
      destination.evidence,
      `The collected journey records ${destination.value} as its final destination.`,
    ),
  ].filter(
    (item, index, values) =>
      values.findIndex((candidate) => candidate.evidenceId === item.evidenceId) === index,
  );
  return baseDraft({
    summary: `This investigation is tracking ${hostname}.`,
    answer: `Packet Journey is tracking ${investigation.normalizedUrl}.${changed ? ` The observed journey ends at ${destination.value}.` : ""}`,
    references,
    selectedStageId: requested?.stage.id,
  });
}

export function deterministicFactDraft(input: {
  question: string;
  investigation: Investigation;
}): AiDiagnosisDraft | undefined {
  const kind = classifyFactQuestion(input.question);
  if (!kind) return undefined;
  const { investigation } = input;
  if (kind === "identity") return identityDraft(investigation);

  if (kind === "final-url") {
    const result = finalUrl(investigation);
    return baseDraft({
      summary: `The journey ends at ${result.value}.`,
      answer: `The final destination recorded by this investigation is ${result.value}.`,
      references: reference(result.evidence, `The collected final URL is ${result.value}.`),
      selectedStageId: result.evidence?.stage.id,
    });
  }

  if (kind === "http-status") {
    const item = findEvidence(investigation, /^Status$/i, { last: true });
    const value = item?.evidence.value;
    if (typeof value !== "number" && typeof value !== "string") return undefined;
    return baseDraft({
      summary: `The final recorded HTTP status is ${String(value)}.`,
      answer: `Packet Journey recorded HTTP ${String(value)} for the final response.`,
      references: reference(item, `The final response recorded HTTP status ${String(value)}.`),
      selectedStageId: item?.stage.id,
    });
  }

  if (kind === "redirect-count") {
    const redirects = investigation.stages.filter((stage) => stage.type === "redirect");
    const firstEvidence = redirects[0]?.evidence[0];
    const item = firstEvidence ? { stage: redirects[0]!, evidence: firstEvidence } : undefined;
    return baseDraft({
      summary: `The journey contains ${redirects.length} redirect${redirects.length === 1 ? "" : "s"}.`,
      answer: `Packet Journey observed ${redirects.length} redirect hop${redirects.length === 1 ? "" : "s"} in this investigation.`,
      references: reference(item, "The redirect stages determine the observed redirect count."),
      selectedStageId: redirects[0]?.id,
    });
  }

  if (kind === "stage-count") {
    const first = investigation.stages[0];
    const item = first?.evidence[0] ? { stage: first, evidence: first.evidence[0] } : undefined;
    return baseDraft({
      summary: `The journey contains ${investigation.stages.length} stages.`,
      answer: `The canonical investigation graph contains ${investigation.stages.length} observed or inferred stages.`,
      references: reference(
        item,
        "This evidence belongs to the first stage in the canonical journey.",
      ),
      selectedStageId: first?.id,
    });
  }

  if (kind === "total-duration") {
    const value = investigation.metrics.totalDurationMs;
    const timedStage = [...investigation.stages]
      .filter((stage) => stage.durationMs !== undefined && stage.evidence[0])
      .sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0))[0];
    const item = timedStage?.evidence[0]
      ? { stage: timedStage, evidence: timedStage.evidence[0] }
      : undefined;
    return baseDraft({
      summary: `The recorded journey duration is ${value} ms.`,
      answer: `Packet Journey recorded ${value} ms for the complete investigation lifecycle represented by this result.`,
      references: reference(
        item,
        "This stage contributes collected timing evidence to the journey.",
      ),
      selectedStageId: timedStage?.id,
    });
  }

  const metric =
    kind === "request-count"
      ? investigation.metrics.requestCount
      : investigation.metrics.thirdPartyCount;
  if (metric === undefined) return undefined;
  const label = kind === "request-count" ? "request" : "third-party request";
  const browserItem = findEvidence(investigation, /(?:resource|request|third.party)/i, {
    stageType: "browser",
    last: true,
  });
  return baseDraft({
    summary: `The investigation recorded ${metric} ${label}${metric === 1 ? "" : "s"}.`,
    answer: `Packet Journey recorded ${metric} ${label}${metric === 1 ? "" : "s"} in this investigation.`,
    references: reference(browserItem, `Browser evidence supports the recorded ${label} count.`),
    selectedStageId: browserItem?.stage.id,
  });
}
