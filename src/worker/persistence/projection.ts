import { investigationSchema, type Investigation } from "../../features/investigation/schema";
import {
  savedInvestigationDetailSchema,
  sharedReportSchema,
  type SavedInvestigationDetail,
  type SharedReport,
} from "../../features/persistence/schema";
import { savedArtifact } from "./artifacts";
import { PERSISTENCE_LIMITS } from "./limits";
import type { ShareRow, StoredInvestigation } from "./types";
import { PersistenceError } from "./errors";

const FRESHNESS_NOTICE =
  "This report reflects one investigation at the captured time and may not represent the website’s current behavior.";

function injectArtifactUrls(
  investigation: Investigation,
  artifacts: ReturnType<typeof savedArtifact>[],
): Investigation {
  const clone = structuredClone(investigation);
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  clone.artifacts = clone.artifacts.flatMap((artifact) => {
    const saved = byId.get(artifact.id);
    return saved ? [{ ...artifact, expiresAt: saved.expiresAt, url: saved.url }] : [];
  });
  return investigationSchema.parse(clone);
}

function publicUrl(value: string): string {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return url.toString();
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (typeof value === "string" && /^https?:\/\//i.test(value)) {
    try {
      return publicUrl(value);
    } catch {
      return value;
    }
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      sanitizeValue(item),
    ]),
  );
}

function publicInvestigation(investigation: Investigation): Investigation {
  const clone = sanitizeValue(structuredClone(investigation)) as Investigation;
  clone.url = publicUrl(clone.url);
  clone.normalizedUrl = publicUrl(clone.normalizedUrl);
  return investigationSchema.parse(clone);
}

function publicDiagnosis(selected: NonNullable<StoredInvestigation["selectedDiagnosis"]>) {
  const clone = structuredClone(selected);
  if (clone.diagnosis.retrievalMetadata) {
    delete clone.diagnosis.retrievalMetadata.controlledQuery;
    delete clone.diagnosis.retrievalMetadata.questionHash;
  }
  return clone;
}

export function savedDetail(stored: StoredInvestigation): SavedInvestigationDetail {
  const artifacts = stored.artifactRows.map((row) =>
    savedArtifact(
      row,
      `/api/v1/saved-investigations/${stored.row.id}/artifacts/${row.artifact_id}`,
    ),
  );
  return savedInvestigationDetailSchema.parse({
    summary: stored.summary,
    investigation: injectArtifactUrls(stored.investigation, artifacts),
    selectedDiagnosis: stored.selectedDiagnosis,
    selectedCounterfactual: stored.selectedCounterfactual,
    artifacts,
    label: "SAVED INVESTIGATION",
    freshnessNotice: FRESHNESS_NOTICE,
  });
}

export function sharedProjection(
  stored: StoredInvestigation,
  share: ShareRow,
  token: string,
): SharedReport {
  const artifacts = share.include_screenshot
    ? stored.artifactRows.map((row) =>
        savedArtifact(
          row,
          `/api/v1/shared-reports/${encodeURIComponent(token)}/artifacts/${row.artifact_id}`,
        ),
      )
    : [];
  const investigation = publicInvestigation(injectArtifactUrls(stored.investigation, artifacts));
  const runtimeLimitations = [
    FRESHNESS_NOTICE,
    "The integrity hash detects stored-data changes but is not a signature or evidence authenticity proof.",
    ...investigation.stages.flatMap((stage) =>
      stage.evidence
        .filter((evidence) => /limitation|unavailable/i.test(evidence.label))
        .map((evidence) => `${stage.title}: ${String(evidence.value).slice(0, 360)}`),
    ),
  ].slice(0, 20);
  const report = sharedReportSchema.parse({
    label: "SAVED SNAPSHOT",
    access: "READ ONLY",
    capturedAt: stored.investigation.completedAt ?? stored.investigation.createdAt,
    freshnessNotice: FRESHNESS_NOTICE,
    title: stored.row.title,
    requestedUrl: publicUrl(stored.row.requested_url),
    ...(stored.row.final_url ? { finalUrl: publicUrl(stored.row.final_url) } : {}),
    status: stored.row.status,
    sourceType: stored.row.source_type,
    investigation,
    ...(share.include_ai_diagnosis && stored.selectedDiagnosis
      ? { selectedDiagnosis: publicDiagnosis(stored.selectedDiagnosis) }
      : {}),
    ...(share.include_counterfactual && stored.selectedCounterfactual
      ? { selectedCounterfactual: stored.selectedCounterfactual }
      : {}),
    artifacts,
    runtimeLimitations,
  });
  if (
    new TextEncoder().encode(JSON.stringify(report)).byteLength >
    PERSISTENCE_LIMITS.maximumReportBytes
  ) {
    throw new PersistenceError(
      413,
      "serialization_too_large",
      "This saved report exceeds the public projection size limit.",
    );
  }
  return report;
}
