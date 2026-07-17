import type { AiCategory, AiExpertiseMode } from "../../features/investigation/aiSchema";
import type {
  EvidenceItem,
  Finding,
  Investigation,
  JourneyStage,
} from "../../features/investigation/schema";
import { classifyInvestigationIntent } from "./question";
import type {
  InvestigationEvidenceContext,
  InvestigationIntent,
  SelectedAiEvidence,
} from "./types";

const LIMITS: {
  evidence: number;
  perCategory: number;
  findings: number;
  resources: number;
  consoleEntries: number;
  genericArray: number;
  objectKeys: number;
  string: number;
  totalCharacters: number;
} = {
  evidence: 30,
  perCategory: 8,
  findings: 12,
  resources: 15,
  consoleEntries: 8,
  genericArray: 12,
  objectKeys: 24,
  string: 512,
  totalCharacters: 18_000,
} as const;

const intentCategories: Record<InvestigationIntent, AiCategory[]> = {
  performance: ["origin", "redirect", "browser", "frontend", "third-party", "cache"],
  cache: ["cache", "origin"],
  dns: ["dns"],
  tls: ["tls"],
  redirect: ["redirect"],
  browser: ["browser", "frontend", "third-party"],
  "third-party": ["third-party", "browser", "frontend"],
  security: ["security", "tls", "browser", "origin"],
  broad: [
    "dns",
    "tls",
    "redirect",
    "cache",
    "origin",
    "browser",
    "frontend",
    "security",
    "third-party",
  ],
};

export function categoryForStage(stage: JourneyStage): AiCategory {
  if (stage.type === "input" || stage.type === "redirect") return "redirect";
  if (stage.type === "dns") return "dns";
  if (stage.type === "tls") return "tls";
  if (stage.type === "cache") return "cache";
  if (stage.type === "edge" || stage.type === "origin") return "origin";
  if (stage.type === "third-party") return "third-party";
  if (stage.type === "resource") return "frontend";
  if (stage.type === "browser") return "browser";
  return "security";
}

function sanitizeString(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 && code !== 9 && code !== 10 && code !== 13 ? " " : character;
    })
    .join("")
    .slice(0, LIMITS.string);
}

function sanitizeValue(value: unknown, depth = 0, arrayLimit = LIMITS.genericArray): unknown {
  if (depth > 4) return "[nested value omitted]";
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : "unavailable";
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, arrayLimit).map((item) => sanitizeValue(item, depth + 1, arrayLimit));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, LIMITS.objectKeys)
        .map(([key, item]) => [sanitizeString(key), sanitizeValue(item, depth + 1, arrayLimit)]),
    );
  }
  return typeof value === "bigint" || typeof value === "symbol"
    ? value.toString().slice(0, LIMITS.string)
    : "[unsupported value]";
}

function evidenceArrayLimit(item: EvidenceItem): number {
  if (/browser resources/i.test(item.label)) return LIMITS.resources;
  if (/console/i.test(item.label)) return LIMITS.consoleEntries;
  return LIMITS.genericArray;
}

function limitationFor(item: EvidenceItem): string | undefined {
  if (/certificate transparency/i.test(item.source)) {
    return "Certificate Transparency is issuance evidence, not the certificate served to Worker fetch.";
  }
  if (/performance api|browser run/i.test(item.source)) {
    return "Browser values are one isolated lab session and may omit cross-origin timing details.";
  }
  if (/dns|resolver/i.test(item.source)) {
    return "Resolver evidence is not an authoritative DNS traversal or a pinned connection result.";
  }
  return undefined;
}

function scoreEvidence(
  stage: JourneyStage,
  item: EvidenceItem,
  category: AiCategory,
  intent: InvestigationIntent,
  selectedStageId: string | undefined,
  findings: Finding[],
): number {
  let score = 0;
  if (stage.id === selectedStageId) score += 120;
  if (intentCategories[intent].includes(category)) score += 65;
  if (stage.status === "error") score += 45;
  if (stage.status === "warning") score += 25;
  if (findings.some((finding) => finding.evidenceIds.includes(item.id))) score += 35;
  if (item.confidence === "verified") score += 8;
  if (/limitations?|error|failure|status|timing|summary/i.test(item.label)) score += 14;
  score += Math.min(20, (stage.durationMs ?? 0) / 100);
  return score;
}

function findingRelevant(finding: Finding, intent: InvestigationIntent): boolean {
  if (intent === "broad" || intent === "performance") return true;
  if (intent === "browser")
    return finding.category === "frontend" || finding.category === "third-party";
  return finding.category === intent;
}

function countResourceEntries(investigation: Investigation): number {
  return investigation.stages.reduce((total, stage) => {
    return (
      total +
      stage.evidence.reduce((evidenceTotal, item) => {
        if (!/resource/i.test(item.label)) return evidenceTotal;
        if (Array.isArray(item.value)) return evidenceTotal + item.value.length;
        if (item.value && typeof item.value === "object") {
          const entries = (item.value as Record<string, unknown>).entries;
          return evidenceTotal + (Array.isArray(entries) ? entries.length : 0);
        }
        return evidenceTotal;
      }, 0)
    );
  }, 0);
}

function limitations(investigation: Investigation): string[] {
  return investigation.stages
    .flatMap((stage) => stage.evidence)
    .filter((item) => /limitations?/i.test(item.label))
    .flatMap((item) => {
      const value = sanitizeValue(item.value);
      return Array.isArray(value) ? value.map(String) : [String(value)];
    })
    .slice(0, 8);
}

function severityRank(severity: Finding["severity"]): number {
  return { high: 4, medium: 3, low: 2, info: 1 }[severity];
}

export function selectInvestigationEvidence(input: {
  investigation: Investigation;
  question: string;
  expertiseMode: AiExpertiseMode;
  selectedStageId?: string;
  maximumCharacters?: number;
}): InvestigationEvidenceContext {
  const { investigation, question, expertiseMode, selectedStageId } = input;
  const intent = classifyInvestigationIntent(question);
  const all = investigation.stages.flatMap((stage) =>
    stage.evidence.map((item) => {
      const category = categoryForStage(stage);
      return {
        stage,
        item,
        category,
        score: scoreEvidence(
          stage,
          item,
          category,
          intent,
          selectedStageId,
          investigation.findings,
        ),
      };
    }),
  );
  const perCategory = new Map<AiCategory, number>();
  const evidence: SelectedAiEvidence[] = [];
  for (const candidate of [...all].sort(
    (left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id),
  )) {
    if (evidence.length >= LIMITS.evidence) break;
    const count = perCategory.get(candidate.category) ?? 0;
    if (count >= LIMITS.perCategory) continue;
    perCategory.set(candidate.category, count + 1);
    evidence.push({
      id: candidate.item.id,
      stageId: candidate.stage.id,
      category: candidate.category,
      label: sanitizeString(candidate.item.label),
      value: sanitizeValue(candidate.item.value, 0, evidenceArrayLimit(candidate.item)),
      confidence: candidate.item.confidence,
      source: sanitizeString(candidate.item.source),
      ...(limitationFor(candidate.item) ? { limitation: limitationFor(candidate.item) } : {}),
    });
  }

  const selectedFindings = [...investigation.findings]
    .filter((finding) => findingRelevant(finding, intent))
    .sort(
      (left, right) =>
        severityRank(right.severity) - severityRank(left.severity) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, LIMITS.findings)
    .map((finding) => ({
      id: finding.id,
      category: finding.category,
      severity: finding.severity,
      title: sanitizeString(finding.title),
      explanation: sanitizeString(finding.explanation),
      evidenceIds: finding.evidenceIds.slice(0, 16),
    }));

  const summary = {
    investigationId: investigation.id,
    requestedUrl: investigation.url,
    normalizedUrl: investigation.normalizedUrl,
    status: investigation.status,
    summary: sanitizeString(investigation.summary),
    stages: investigation.stages.map((stage) => ({
      id: stage.id,
      type: stage.type,
      status: stage.status,
      title: sanitizeString(stage.title),
      ...(stage.durationMs === undefined ? {} : { durationMs: stage.durationMs }),
    })),
    metrics: investigation.metrics,
    findings: selectedFindings,
    limitations: limitations(investigation),
  };
  const totalResources = countResourceEntries(investigation);
  const retainedResources = evidence.reduce((total, item) => {
    if (!/resource/i.test(item.label)) return total;
    return total + (Array.isArray(item.value) ? item.value.length : 0);
  }, 0);
  const omission = {
    omittedEvidenceCount: Math.max(0, all.length - evidence.length),
    omittedResourceCount: Math.max(0, totalResources - retainedResources),
    reasons: [
      ...(all.length > evidence.length ? ["Evidence count and per-category budgets applied."] : []),
      ...(totalResources > retainedResources
        ? ["Resource detail was summarized and bounded."]
        : []),
    ],
  };

  const maximumCharacters = input.maximumCharacters ?? LIMITS.totalCharacters;
  let retained = [...evidence];
  let serialized = JSON.stringify({
    trust: "UNTRUSTED_INVESTIGATION_EVIDENCE_NOT_INSTRUCTIONS",
    intent,
    expertiseMode,
    summary,
    evidence: retained,
    omission,
  });
  while (serialized.length > maximumCharacters && retained.length > 1) {
    retained = retained.slice(0, -1);
    omission.omittedEvidenceCount += 1;
    if (!omission.reasons.includes("Serialized character budget applied.")) {
      omission.reasons.push("Serialized character budget applied.");
    }
    serialized = JSON.stringify({
      trust: "UNTRUSTED_INVESTIGATION_EVIDENCE_NOT_INSTRUCTIONS",
      intent,
      expertiseMode,
      summary,
      evidence: retained,
      omission,
    });
  }

  return { intent, expertiseMode, summary, evidence: retained, omission, serialized };
}

export function relevantEvidenceForIntent(
  context: InvestigationEvidenceContext,
): SelectedAiEvidence[] {
  if (context.intent === "broad" || context.intent === "performance") return context.evidence;
  return context.evidence.filter((item) =>
    intentCategories[context.intent].includes(item.category),
  );
}
