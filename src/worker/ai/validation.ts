import {
  aiActionSchema,
  aiCounterfactualReferenceSchema,
  aiDiagnosisDraftSchema,
  aiEvidenceReferenceSchema,
  aiFindingSchema,
  aiTechnicalReferenceSchema,
  aiUncertaintySchema,
  type AiCategory,
  type AiDiagnosisDraft,
  type AiFinding,
  type CounterfactualAiContext,
} from "../../features/investigation/aiSchema";
import type { Investigation } from "../../features/investigation/schema";
import { categoryForStage } from "./evidenceSelection";
import { z } from "zod";

export class AiOutputError extends Error {
  constructor(
    readonly code: "schema" | "unknown_reference" | "unsupported_claim",
    message: string,
  ) {
    super(message);
    this.name = "AiOutputError";
  }
}

const UNSUPPORTED_CAUSAL_CLAIM =
  /\b(definitely|caused by|the root cause|guaranteed|always|completely secure|no vulnerabilities)\b/i;
const PROOF_CLAIM = /\bproves?\b/gi;
const NEGATED_PROOF_PREFIX =
  /(?:\b(?:does|do|did|can|could|would|will|is|are|was|were|has|have|had)\s+not\s+|\b(?:doesn't|doesn’t|didn't|didn’t|cannot|can't|can’t|couldn't|couldn’t|wouldn't|wouldn’t)\s+|\bno\s+(?:available\s+)?evidence\s+)$/i;

function hasUnsupportedCausalClaim(value: string): boolean {
  if (UNSUPPORTED_CAUSAL_CLAIM.test(value)) return true;
  return [...value.matchAll(PROOF_CLAIM)].some((match) => {
    const prefix = value.slice(Math.max(0, (match.index ?? 0) - 48), match.index);
    return !NEGATED_PROOF_PREFIX.test(prefix);
  });
}

function allEvidenceReferences(draft: AiDiagnosisDraft) {
  return [
    ...(draft.primaryFinding?.evidenceIds ?? []),
    ...draft.relatedFindings.flatMap((finding) => finding.evidenceIds),
    ...draft.prioritizedActions.flatMap((action) => action.evidenceIds),
    ...draft.evidenceReferences.map((reference) => reference.evidenceId),
    ...draft.graphInstructions.emphasizeEvidenceIds,
  ];
}

function validArrayItems<T>(value: unknown, schema: z.ZodType<T>): unknown {
  if (!Array.isArray(value)) return value;
  return value.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

function normalizeOptionalEnrichment(output: unknown): unknown {
  if (!output || typeof output !== "object" || Array.isArray(output)) return output;
  const root = output as Record<string, unknown>;
  const primary = aiFindingSchema.safeParse(root.primaryFinding);
  return {
    ...root,
    ...(root.primaryFinding === undefined
      ? {}
      : { primaryFinding: primary.success ? primary.data : undefined }),
    relatedFindings: validArrayItems(root.relatedFindings, aiFindingSchema),
    prioritizedActions: validArrayItems(root.prioritizedActions, aiActionSchema),
    evidenceReferences: validArrayItems(root.evidenceReferences, aiEvidenceReferenceSchema),
    technicalReferences: validArrayItems(root.technicalReferences, aiTechnicalReferenceSchema),
    ...(root.counterfactualReferences === undefined
      ? {}
      : {
          counterfactualReferences: validArrayItems(
            root.counterfactualReferences,
            aiCounterfactualReferenceSchema,
          ),
        }),
    uncertainties: validArrayItems(root.uncertainties, aiUncertaintySchema),
  };
}

function categoryCompatible(finding: AiFinding, categories: AiCategory[]): boolean {
  if (categories.includes(finding.category)) return true;
  if (finding.category === "security") {
    return categories.some((category) =>
      ["origin", "tls", "browser", "security"].includes(category),
    );
  }
  if (finding.category === "frontend") {
    return categories.some((category) => ["browser", "third-party"].includes(category));
  }
  return false;
}

export function validateAiDiagnosisOutput(
  output: unknown,
  investigation: Investigation,
  counterfactual?: CounterfactualAiContext,
  allowedCitationIds: ReadonlySet<string> = new Set(),
): AiDiagnosisDraft {
  const parsed = aiDiagnosisDraftSchema.safeParse(normalizeOptionalEnrichment(output));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join(".") || "root"}:${issue.code}`)
      .join(", ");
    throw new AiOutputError(
      "schema",
      `The model response did not match the required diagnosis schema (${issues}).`,
    );
  }
  const draft = parsed.data;
  for (const reference of draft.technicalReferences) {
    if (!allowedCitationIds.has(reference.citationId)) {
      throw new AiOutputError(
        "unknown_reference",
        "The model referenced a technical citation that was not supplied.",
      );
    }
  }
  const evidenceToStage = new Map(
    investigation.stages.flatMap((stage) =>
      stage.evidence.map((item) => [item.id, stage.id] as const),
    ),
  );
  const stageIds = new Set(investigation.stages.map((stage) => stage.id));
  const findingIds = new Set(investigation.findings.map((finding) => finding.id));
  const changeIds = new Set(counterfactual?.changes.map((change) => change.id) ?? []);
  const assumptionIds = new Set(
    counterfactual?.assumptions.map((assumption) => assumption.id) ?? [],
  );
  const evidenceCategories = new Map(
    investigation.stages.flatMap((stage) =>
      stage.evidence.map((item) => [item.id, categoryForStage(stage)] as const),
    ),
  );
  for (const id of allEvidenceReferences(draft)) {
    if (!evidenceToStage.has(id)) {
      throw new AiOutputError(
        "unknown_reference",
        "The model referenced evidence outside this investigation.",
      );
    }
  }
  for (const reference of draft.evidenceReferences) {
    if (evidenceToStage.get(reference.evidenceId) !== reference.stageId) {
      throw new AiOutputError(
        "unknown_reference",
        "The model attached evidence to the wrong stage.",
      );
    }
  }
  for (const reference of draft.counterfactualReferences ?? []) {
    const allowed = reference.type === "change" ? changeIds : assumptionIds;
    if (!allowed.has(reference.id)) {
      throw new AiOutputError(
        "unknown_reference",
        "The model referenced counterfactual provenance outside this simulation.",
      );
    }
  }
  if (
    counterfactual &&
    (draft.conclusionType === "supported" || draft.conclusionType === "likely") &&
    !draft.counterfactualReferences?.length
  ) {
    throw new AiOutputError(
      "unknown_reference",
      "A supported counterfactual explanation must cite a change or assumption ID.",
    );
  }
  for (const id of [
    ...draft.graphInstructions.emphasizeStageIds,
    ...draft.graphInstructions.dimStageIds,
    ...(draft.graphInstructions.selectedStageId ? [draft.graphInstructions.selectedStageId] : []),
  ]) {
    if (!stageIds.has(id)) {
      throw new AiOutputError(
        "unknown_reference",
        "The model referenced a stage outside this investigation.",
      );
    }
  }
  for (const finding of [
    ...(draft.primaryFinding ? [draft.primaryFinding] : []),
    ...draft.relatedFindings,
  ]) {
    const categories = finding.evidenceIds.flatMap((id) => {
      const category = evidenceCategories.get(id);
      return category ? [category] : [];
    });
    if (!categoryCompatible(finding, categories)) {
      throw new AiOutputError(
        "unsupported_claim",
        "An AI finding cited evidence unrelated to its category.",
      );
    }
  }
  for (const id of [
    ...(draft.primaryFinding?.deterministicFindingIds ?? []),
    ...draft.relatedFindings.flatMap((finding) => finding.deterministicFindingIds ?? []),
  ]) {
    if (!findingIds.has(id)) {
      throw new AiOutputError(
        "unknown_reference",
        "The model referenced an unknown deterministic finding.",
      );
    }
  }
  const cited = new Set(draft.evidenceReferences.map((reference) => reference.evidenceId));
  if (
    (draft.conclusionType === "supported" || draft.conclusionType === "likely") &&
    (!allEvidenceReferences(draft).length ||
      allEvidenceReferences(draft).some((id) => !cited.has(id)))
  ) {
    throw new AiOutputError(
      "unknown_reference",
      "Every diagnosis claim must have an evidence reference.",
    );
  }
  if (draft.conclusionType === "inconclusive" && draft.confidence > 0.5) {
    throw new AiOutputError(
      "unsupported_claim",
      "An inconclusive answer cannot claim high confidence.",
    );
  }
  if (draft.conclusionType === "unsupported" && draft.confidence > 0.2) {
    throw new AiOutputError("unsupported_claim", "An unsupported answer cannot claim confidence.");
  }
  if (
    hasUnsupportedCausalClaim(`${draft.summary} ${draft.answer}`) &&
    draft.conclusionType !== "inconclusive"
  ) {
    throw new AiOutputError("unsupported_claim", "The model overstated certainty or causation.");
  }
  return draft;
}
