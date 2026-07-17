import { aiDiagnosisSchema, type AiDiagnosisDraft } from "../../features/investigation/aiSchema";
import { investigationSchema, type Investigation } from "../../features/investigation/schema";
import {
  PERSISTED_INVESTIGATION_SCHEMA_VERSION,
  selectedDiagnosisSchema,
  type SaveInvestigationRequest,
  type SelectedDiagnosis,
} from "../../features/persistence/schema";
import {
  counterfactualResultSchema,
  type CounterfactualResult,
} from "../../features/counterfactual/schemas";
import { validateAiDiagnosisOutput } from "../ai/validation";
import { sha256Hex } from "./crypto";
import { PersistenceError } from "./errors";
import { PERSISTENCE_LIMITS } from "./limits";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stable(item)]),
  );
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stable(value));
}

function snapshotInvestigation(input: Investigation): Investigation {
  const investigation = investigationSchema.parse(structuredClone(input));
  investigation.artifacts = investigation.artifacts.map((artifact) => {
    const snapshot = { ...artifact };
    delete snapshot.url;
    return snapshot;
  });
  return investigationSchema.parse(investigation);
}

function diagnosisDraft(selected: SelectedDiagnosis): AiDiagnosisDraft {
  const diagnosis = aiDiagnosisSchema.parse(selected.diagnosis);
  return {
    summary: diagnosis.summary,
    answer: diagnosis.answer,
    confidence: diagnosis.confidence,
    conclusionType: diagnosis.conclusionType,
    ...(diagnosis.primaryFinding ? { primaryFinding: diagnosis.primaryFinding } : {}),
    relatedFindings: diagnosis.relatedFindings,
    prioritizedActions: diagnosis.prioritizedActions,
    evidenceReferences: diagnosis.evidenceReferences,
    ...(diagnosis.counterfactualReferences
      ? { counterfactualReferences: diagnosis.counterfactualReferences }
      : {}),
    uncertainties: diagnosis.uncertainties,
    followUpQuestions: diagnosis.followUpQuestions,
    graphInstructions: diagnosis.graphInstructions,
  };
}

function validateSelectedDiagnosis(
  selected: SelectedDiagnosis | undefined,
  investigation: Investigation,
): SelectedDiagnosis | undefined {
  if (!selected) return undefined;
  const parsed = selectedDiagnosisSchema.parse(selected);
  validateAiDiagnosisOutput(diagnosisDraft(parsed), investigation);
  return parsed;
}

async function snapshotHash(investigation: Investigation): Promise<string> {
  return sha256Hex(
    `${PERSISTED_INVESTIGATION_SCHEMA_VERSION}:${stableStringify(snapshotInvestigation(investigation))}`,
  );
}

async function validateCounterfactual(
  input: CounterfactualResult | undefined,
  investigation: Investigation,
  hash: string,
): Promise<CounterfactualResult | undefined> {
  if (!input) return undefined;
  const result = counterfactualResultSchema.parse(structuredClone(input));
  if (result.sourceInvestigationId !== investigation.id) {
    throw new PersistenceError(
      400,
      "invalid_saved_investigation",
      "The selected counterfactual belongs to a different investigation.",
    );
  }
  if ((await snapshotHash(result.observed)) !== hash) {
    throw new PersistenceError(
      400,
      "invalid_saved_investigation",
      "The selected counterfactual does not match the saved evidence snapshot.",
    );
  }
  result.observed = snapshotInvestigation(result.observed);
  result.simulated = snapshotInvestigation(result.simulated);
  return counterfactualResultSchema.parse(result);
}

export async function serializeSaveRequest(input: SaveInvestigationRequest) {
  const investigation = snapshotInvestigation(input.investigation);
  if (
    !["completed", "failed"].includes(investigation.status) ||
    !investigation.stages.some((stage) => stage.evidence.length)
  ) {
    throw new PersistenceError(
      400,
      "invalid_saved_investigation",
      "Only completed or meaningfully partial investigations can be saved.",
    );
  }
  const serialized = stableStringify(investigation);
  if (new TextEncoder().encode(serialized).byteLength > PERSISTENCE_LIMITS.maximumSnapshotBytes) {
    throw new PersistenceError(
      413,
      "serialization_too_large",
      "This investigation exceeds the bounded D1 snapshot size.",
    );
  }
  const investigationHash = await snapshotHash(investigation);
  const selectedDiagnosis = validateSelectedDiagnosis(input.selectedDiagnosis, investigation);
  const selectedCounterfactual = await validateCounterfactual(
    input.selectedCounterfactual,
    investigation,
    investigationHash,
  );
  return {
    investigation,
    serialized,
    investigationHash,
    selectedDiagnosis,
    selectedDiagnosisJson: selectedDiagnosis
      ? stableStringify(selectedDiagnosis.diagnosis)
      : undefined,
    selectedCounterfactual,
    selectedCounterfactualJson: selectedCounterfactual
      ? stableStringify(selectedCounterfactual)
      : undefined,
    schemaVersion: PERSISTED_INVESTIGATION_SCHEMA_VERSION,
  };
}

export function deserializeInvestigation(json: string, schemaVersion: number): Investigation {
  if (schemaVersion !== PERSISTED_INVESTIGATION_SCHEMA_VERSION) {
    throw new PersistenceError(
      409,
      "unsupported_schema_version",
      "This saved investigation uses an unsupported snapshot schema version.",
    );
  }
  try {
    return investigationSchema.parse(JSON.parse(json) as unknown);
  } catch {
    throw new PersistenceError(
      500,
      "invalid_saved_investigation",
      "The stored investigation failed integrity validation.",
    );
  }
}

export async function verifyStoredHash(
  investigation: Investigation,
  storedHash: string,
): Promise<void> {
  if ((await snapshotHash(investigation)) !== storedHash) {
    throw new PersistenceError(
      500,
      "invalid_saved_investigation",
      "The stored investigation consistency hash did not match.",
    );
  }
}
