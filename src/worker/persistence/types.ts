import type { Investigation } from "../../features/investigation/schema";
import type {
  SavedArtifact,
  SavedInvestigationSummary,
  SelectedDiagnosis,
  ShareOptions,
  ShareSummary,
} from "../../features/persistence/schema";
import type { CounterfactualResult } from "../../features/counterfactual/schemas";

export interface InvestigationRow {
  id: string;
  owner_id: string;
  source_investigation_id: string;
  title: string;
  requested_url: string;
  final_url: string | null;
  hostname: string;
  status: "completed" | "failed";
  source_type: "live" | "recorded";
  schema_version: number;
  investigation_json: string;
  investigation_hash: string;
  high_findings: number;
  medium_findings: number;
  low_findings: number;
  info_findings: number;
  has_ai_diagnosis: number;
  has_counterfactual: number;
  has_screenshot: number;
  created_at: string;
  completed_at: string | null;
  saved_at: string;
  updated_at: string;
}

export interface DiagnosisRow {
  diagnosis_json: string;
  expertise_mode: SelectedDiagnosis["expertiseMode"];
}

export interface CounterfactualRow {
  result_json: string;
}

export interface ArtifactRow {
  investigation_id: string;
  artifact_id: string;
  r2_key: string;
  artifact_type: "screenshot";
  content_type: SavedArtifact["contentType"];
  size_bytes: number;
  created_at: string;
  expires_at: string;
}

export interface ShareRow {
  id: string;
  investigation_id: string;
  token_hash: string;
  include_ai_diagnosis: number;
  include_counterfactual: number;
  include_screenshot: number;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_accessed_at: string | null;
  access_count: number;
}

export interface StoredInvestigation {
  row: InvestigationRow;
  investigation: Investigation;
  summary: SavedInvestigationSummary;
  selectedDiagnosis?: SelectedDiagnosis;
  selectedCounterfactual?: CounterfactualResult;
  artifactRows: ArtifactRow[];
}

export interface CreateSavedRecordInput {
  id: string;
  ownerId: string;
  title: string;
  requestedUrl: string;
  finalUrl?: string;
  hostname: string;
  sourceType: "live" | "recorded";
  investigation: Investigation;
  schemaVersion: number;
  serialized: string;
  investigationHash: string;
  selectedDiagnosis?: SelectedDiagnosis;
  selectedDiagnosisJson?: string;
  selectedCounterfactual?: CounterfactualResult;
  selectedCounterfactualJson?: string;
  artifactRows: ArtifactRow[];
  now: string;
}

export interface CreateShareInput {
  id: string;
  investigationId: string;
  ownerId: string;
  tokenHash: string;
  options: ShareOptions;
  now: string;
}

export function shareSummary(row: ShareRow): ShareSummary {
  return {
    id: row.id,
    createdAt: row.created_at,
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
    ...(row.last_accessed_at ? { lastAccessedAt: row.last_accessed_at } : {}),
    accessCount: row.access_count,
    options: {
      includeAiDiagnosis: row.include_ai_diagnosis === 1,
      includeCounterfactual: row.include_counterfactual === 1,
      includeScreenshot: row.include_screenshot === 1,
    },
  };
}
