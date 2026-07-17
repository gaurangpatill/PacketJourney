import { aiDiagnosisSchema } from "../../../features/investigation/aiSchema";
import { counterfactualResultSchema } from "../../../features/counterfactual/schemas";
import {
  savedInvestigationSummarySchema,
  selectedDiagnosisSchema,
  type SavedInvestigationSummary,
} from "../../../features/persistence/schema";
import { databaseFailure, PersistenceError } from "../errors";
import { PERSISTENCE_LIMITS } from "../limits";
import { deserializeInvestigation, verifyStoredHash } from "../serialization";
import type {
  ArtifactRow,
  CounterfactualRow,
  CreateSavedRecordInput,
  DiagnosisRow,
  InvestigationRow,
  StoredInvestigation,
} from "../types";

function findingCounts(input: CreateSavedRecordInput) {
  return {
    high: input.investigation.findings.filter((finding) => finding.severity === "high").length,
    medium: input.investigation.findings.filter((finding) => finding.severity === "medium").length,
    low: input.investigation.findings.filter((finding) => finding.severity === "low").length,
    info: input.investigation.findings.filter((finding) => finding.severity === "info").length,
  };
}

function summary(row: InvestigationRow): SavedInvestigationSummary {
  return savedInvestigationSummarySchema.parse({
    id: row.id,
    sourceInvestigationId: row.source_investigation_id,
    title: row.title,
    requestedUrl: row.requested_url,
    ...(row.final_url ? { finalUrl: row.final_url } : {}),
    hostname: row.hostname,
    status: row.status,
    sourceType: row.source_type,
    schemaVersion: row.schema_version,
    investigationHash: row.investigation_hash,
    findingCounts: {
      high: row.high_findings,
      medium: row.medium_findings,
      low: row.low_findings,
      info: row.info_findings,
    },
    hasAiDiagnosis: row.has_ai_diagnosis === 1,
    hasCounterfactual: row.has_counterfactual === 1,
    hasScreenshot: row.has_screenshot === 1,
    createdAt: row.created_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    savedAt: row.saved_at,
    updatedAt: row.updated_at,
  });
}

function cursorValue(value: string | undefined): { updatedAt: string; id: string } | undefined {
  if (!value || value.length > 500) return undefined;
  try {
    const decoded = JSON.parse(atob(value.replace(/-/g, "+").replace(/_/g, "/"))) as unknown;
    if (!decoded || typeof decoded !== "object") return undefined;
    const item = decoded as Record<string, unknown>;
    if (typeof item.updatedAt !== "string" || typeof item.id !== "string") return undefined;
    return { updatedAt: item.updatedAt, id: item.id };
  } catch {
    return undefined;
  }
}

function encodeCursor(row: InvestigationRow): string {
  return btoa(JSON.stringify({ updatedAt: row.updated_at, id: row.id }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export class InvestigationRepository {
  constructor(private readonly database: D1Database) {}

  async create(input: CreateSavedRecordInput): Promise<{ duplicate: boolean }> {
    const counts = findingCounts(input);
    try {
      const [ownerCount, duplicate] = await this.database.batch([
        this.database
          .prepare("SELECT COUNT(*) AS count FROM investigations WHERE owner_id = ?1")
          .bind(input.ownerId),
        this.database
          .prepare(
            "SELECT COUNT(*) AS count FROM investigations WHERE owner_id = ?1 AND investigation_hash = ?2",
          )
          .bind(input.ownerId, input.investigationHash),
      ]);
      if (!ownerCount || !duplicate) throw databaseFailure();
      const total = Number((ownerCount.results[0] as { count?: number } | undefined)?.count ?? 0);
      if (total >= PERSISTENCE_LIMITS.maximumSavedInvestigations) {
        throw new PersistenceError(
          409,
          "invalid_saved_investigation",
          "This anonymous installation has reached its saved-investigation limit.",
        );
      }
      const statements: D1PreparedStatement[] = [
        this.database
          .prepare(
            `INSERT INTO investigations (
              id, owner_id, source_investigation_id, title, requested_url, final_url, hostname,
              status, source_type, schema_version, investigation_json, investigation_hash,
              high_findings, medium_findings, low_findings, info_findings,
              has_ai_diagnosis, has_counterfactual, has_screenshot,
              created_at, completed_at, saved_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)`,
          )
          .bind(
            input.id,
            input.ownerId,
            input.investigation.id,
            input.title,
            input.requestedUrl,
            input.finalUrl ?? null,
            input.hostname,
            input.investigation.status,
            input.sourceType,
            input.schemaVersion,
            input.serialized,
            input.investigationHash,
            counts.high,
            counts.medium,
            counts.low,
            counts.info,
            input.selectedDiagnosis ? 1 : 0,
            input.selectedCounterfactual ? 1 : 0,
            input.artifactRows.length ? 1 : 0,
            input.investigation.createdAt,
            input.investigation.completedAt ?? null,
            input.now,
            input.now,
          ),
      ];
      if (input.selectedDiagnosis && input.selectedDiagnosisJson) {
        statements.push(
          this.database
            .prepare(
              `INSERT INTO ai_diagnoses (
                id, investigation_id, question, expertise_mode, diagnosis_json, model, prompt_version, created_at
              ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
            )
            .bind(
              input.selectedDiagnosis.diagnosis.id,
              input.id,
              input.selectedDiagnosis.diagnosis.question,
              input.selectedDiagnosis.expertiseMode,
              input.selectedDiagnosisJson,
              input.selectedDiagnosis.diagnosis.model,
              input.selectedDiagnosis.diagnosis.promptVersion,
              input.selectedDiagnosis.diagnosis.generatedAt,
            ),
        );
        const retrieval = input.selectedDiagnosis.diagnosis.retrievalMetadata;
        if (retrieval) {
          if (!retrieval.questionHash || !retrieval.controlledQuery) throw databaseFailure();
          statements.push(
            this.database
              .prepare(
                `INSERT INTO diagnosis_reference_runs (
                  id, diagnosis_id, question_hash, retrieval_query, retrieval_version,
                  embedding_model, dimensions, index_version, corpus_version, filter_json,
                  candidate_count, selected_count, retrieval_status, retrieved_at, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
              )
              .bind(
                retrieval.retrievalRunId,
                input.selectedDiagnosis.diagnosis.id,
                retrieval.questionHash,
                retrieval.controlledQuery,
                retrieval.retrievalVersion,
                retrieval.embeddingModel,
                retrieval.dimensions,
                retrieval.indexVersion,
                retrieval.corpusVersion,
                JSON.stringify(retrieval.filter),
                retrieval.candidateCount,
                retrieval.selectedCount,
                retrieval.status,
                retrieval.retrievedAt,
                input.now,
              ),
          );
          for (const citation of input.selectedDiagnosis.diagnosis.referenceCitations) {
            statements.push(
              this.database
                .prepare(
                  `INSERT INTO diagnosis_reference_citations (
                    id, retrieval_run_id, chunk_id, source_id, rank, similarity_score,
                    rerank_score, citation_status, citation_reason, frozen_publisher,
                    frozen_category, frozen_title, frozen_url, frozen_heading, frozen_excerpt,
                    frozen_content_hash, frozen_source_version, frozen_source_retrieved_at,
                    frozen_corpus_version, created_at
                  ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)`,
                )
                .bind(
                  `${retrieval.retrievalRunId}:${citation.citationId}`,
                  retrieval.retrievalRunId,
                  citation.referenceChunkId,
                  citation.sourceId,
                  citation.rank,
                  citation.similarityScore,
                  citation.rerankScore,
                  "validated",
                  citation.selectionReason,
                  citation.publisher,
                  citation.category,
                  citation.title,
                  citation.canonicalUrl,
                  citation.heading,
                  citation.excerpt,
                  citation.contentHash,
                  citation.sourceVersion ?? null,
                  citation.sourceRetrievedAt,
                  citation.corpusVersion,
                  input.now,
                ),
            );
          }
        }
      }
      if (input.selectedCounterfactual && input.selectedCounterfactualJson) {
        statements.push(
          this.database
            .prepare(
              `INSERT INTO counterfactual_results (
                id, investigation_id, source_investigation_hash, scenario_type, result_json, engine_version, created_at
              ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
            )
            .bind(
              input.selectedCounterfactual.id,
              input.id,
              input.investigationHash,
              input.selectedCounterfactual.scenario.type,
              input.selectedCounterfactualJson,
              input.selectedCounterfactual.engineVersion,
              input.selectedCounterfactual.generatedAt,
            ),
        );
      }
      for (const artifact of input.artifactRows) {
        statements.push(
          this.database
            .prepare(
              `INSERT INTO investigation_artifacts (
                investigation_id, artifact_id, r2_key, artifact_type, content_type, size_bytes, created_at, expires_at
              ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
            )
            .bind(
              artifact.investigation_id,
              artifact.artifact_id,
              artifact.r2_key,
              artifact.artifact_type,
              artifact.content_type,
              artifact.size_bytes,
              artifact.created_at,
              artifact.expires_at,
            ),
        );
      }
      await this.database.batch(statements);
      return {
        duplicate: Number((duplicate.results[0] as { count?: number } | undefined)?.count ?? 0) > 0,
      };
    } catch (error) {
      if (error instanceof PersistenceError) throw error;
      throw databaseFailure();
    }
  }

  async list(input: {
    ownerId: string;
    cursor?: string;
    limit: number;
    status?: "completed" | "failed";
    sourceType?: "live" | "recorded";
    hostname?: string;
  }): Promise<{ items: SavedInvestigationSummary[]; nextCursor?: string }> {
    const cursor = cursorValue(input.cursor);
    const hostnamePattern = input.hostname ? `%${input.hostname.toLowerCase()}%` : null;
    try {
      const result = await this.database
        .prepare(
          `SELECT * FROM investigations
           WHERE owner_id = ?1
             AND (?2 IS NULL OR status = ?2)
             AND (?3 IS NULL OR source_type = ?3)
             AND (?4 IS NULL OR hostname LIKE ?4)
             AND (?5 IS NULL OR updated_at < ?5 OR (updated_at = ?5 AND id < ?6))
           ORDER BY updated_at DESC, id DESC
           LIMIT ?7`,
        )
        .bind(
          input.ownerId,
          input.status ?? null,
          input.sourceType ?? null,
          hostnamePattern,
          cursor?.updatedAt ?? null,
          cursor?.id ?? null,
          input.limit + 1,
        )
        .all<InvestigationRow>();
      const rows = result.results;
      const visible = rows.slice(0, input.limit);
      return {
        items: visible.map(summary),
        ...(rows.length > input.limit && visible.length
          ? { nextCursor: encodeCursor(visible[visible.length - 1]!) }
          : {}),
      };
    } catch {
      throw databaseFailure();
    }
  }

  async get(ownerId: string, id: string): Promise<StoredInvestigation> {
    let row: InvestigationRow | null;
    try {
      row = await this.database
        .prepare("SELECT * FROM investigations WHERE id = ?1 AND owner_id = ?2")
        .bind(id, ownerId)
        .first<InvestigationRow>();
    } catch {
      throw databaseFailure();
    }
    if (!row) {
      throw new PersistenceError(
        404,
        "saved_investigation_not_found",
        "Saved investigation not found.",
      );
    }
    const investigation = deserializeInvestigation(row.investigation_json, row.schema_version);
    await verifyStoredHash(investigation, row.investigation_hash);
    try {
      const [diagnosis, counterfactual, artifacts] = await this.database.batch([
        this.database
          .prepare(
            "SELECT diagnosis_json, expertise_mode FROM ai_diagnoses WHERE investigation_id = ?1",
          )
          .bind(id),
        this.database
          .prepare("SELECT result_json FROM counterfactual_results WHERE investigation_id = ?1")
          .bind(id),
        this.database
          .prepare("SELECT * FROM investigation_artifacts WHERE investigation_id = ?1")
          .bind(id),
      ]);
      if (!diagnosis || !counterfactual || !artifacts) throw databaseFailure();
      const diagnosisRow = diagnosis.results[0] as DiagnosisRow | undefined;
      const counterfactualRow = counterfactual.results[0] as CounterfactualRow | undefined;
      return {
        row,
        investigation,
        summary: summary(row),
        ...(diagnosisRow
          ? {
              selectedDiagnosis: selectedDiagnosisSchema.parse({
                diagnosis: aiDiagnosisSchema.parse(
                  JSON.parse(diagnosisRow.diagnosis_json) as unknown,
                ),
                expertiseMode: diagnosisRow.expertise_mode,
              }),
            }
          : {}),
        ...(counterfactualRow
          ? {
              selectedCounterfactual: counterfactualResultSchema.parse(
                JSON.parse(counterfactualRow.result_json) as unknown,
              ),
            }
          : {}),
        artifactRows: artifacts.results as unknown as ArtifactRow[],
      };
    } catch (error) {
      if (error instanceof PersistenceError) throw error;
      throw databaseFailure();
    }
  }

  async rename(ownerId: string, id: string, title: string, now: string) {
    try {
      const result = await this.database
        .prepare(
          "UPDATE investigations SET title = ?1, updated_at = ?2 WHERE id = ?3 AND owner_id = ?4",
        )
        .bind(title, now, id, ownerId)
        .run();
      if (!result.meta.changes) {
        throw new PersistenceError(
          404,
          "saved_investigation_not_found",
          "Saved investigation not found.",
        );
      }
    } catch (error) {
      if (error instanceof PersistenceError) throw error;
      throw databaseFailure();
    }
  }

  async artifactRows(ownerId: string, id: string): Promise<ArtifactRow[]> {
    try {
      const result = await this.database
        .prepare(
          `SELECT a.* FROM investigation_artifacts a
           INNER JOIN investigations i ON i.id = a.investigation_id
           WHERE i.id = ?1 AND i.owner_id = ?2`,
        )
        .bind(id, ownerId)
        .all<ArtifactRow>();
      return result.results;
    } catch {
      throw databaseFailure();
    }
  }

  async delete(ownerId: string, id: string): Promise<boolean> {
    try {
      const result = await this.database
        .prepare("DELETE FROM investigations WHERE id = ?1 AND owner_id = ?2")
        .bind(id, ownerId)
        .run();
      return Boolean(result.meta.changes);
    } catch {
      throw databaseFailure();
    }
  }

  async recordCleanupFailure(key: string, now: string): Promise<void> {
    try {
      await this.database
        .prepare(
          "INSERT INTO artifact_cleanup_failures (id, r2_key, recorded_at, last_error_code) VALUES (?1, ?2, ?3, ?4)",
        )
        .bind(crypto.randomUUID(), key, now, "r2_delete_failed")
        .run();
    } catch {
      // Logging remains the final repair signal when D1 itself is unavailable.
    }
  }
}
