import {
  createShareResponseSchema,
  saveInvestigationResponseSchema,
  shareOptionsSchema,
  type SaveInvestigationRequest,
} from "../../features/persistence/schema";
import { logEvent } from "../logging";
import type { Env } from "../env";
import { promoteScreenshot, retrieveSavedArtifact, rollbackPromotions } from "./artifacts";
import { isValidOpaqueToken, randomToken, sha256Hex } from "./crypto";
import { PersistenceError, requireDatabase } from "./errors";
import { PERSISTENCE_LIMITS } from "./limits";
import { savedDetail, sharedProjection } from "./projection";
import { InvestigationRepository } from "./repositories/investigations";
import { ShareRepository } from "./repositories/shares";
import { serializeSaveRequest } from "./serialization";

function publicUrl(value: string): string {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return url.toString();
}

function finalUrl(input: SaveInvestigationRequest["investigation"]): string | undefined {
  const final = [...input.stages]
    .reverse()
    .flatMap((stage) => stage.evidence)
    .find(
      (evidence) =>
        /^(browser final url|final url|url)$/i.test(evidence.label) &&
        typeof evidence.value === "string" &&
        /^https?:\/\//i.test(evidence.value),
    );
  return typeof final?.value === "string" ? publicUrl(final.value) : undefined;
}

export class PersistenceService {
  private readonly investigations: InvestigationRepository;
  private readonly shares: ShareRepository;

  constructor(
    private readonly env: Env,
    private readonly now: () => Date = () => new Date(),
  ) {
    const database = requireDatabase(env.DB);
    this.investigations = new InvestigationRepository(database);
    this.shares = new ShareRepository(database);
  }

  async save(ownerId: string, request: SaveInvestigationRequest) {
    const prepared = await serializeSaveRequest(request);
    const id = crypto.randomUUID();
    const now = this.now();
    const screenshot = request.preserveScreenshot
      ? request.investigation.artifacts.find((artifact) => artifact.type === "screenshot")
      : undefined;
    const promotion = await promoteScreenshot({
      bucket: this.env.BROWSER_ARTIFACTS,
      investigationId: id,
      artifact: screenshot,
      now,
    });
    const artifactRows = promotion.row ? [promotion.row] : [];
    try {
      const duplicate = await this.investigations.create({
        id,
        ownerId,
        title: request.title ?? request.investigation.title,
        requestedUrl: publicUrl(request.investigation.url),
        finalUrl: finalUrl(request.investigation),
        hostname: new URL(request.investigation.normalizedUrl).hostname.toLowerCase(),
        sourceType: request.investigation.mock ? "recorded" : "live",
        investigation: prepared.investigation,
        schemaVersion: prepared.schemaVersion,
        serialized: prepared.serialized,
        investigationHash: prepared.investigationHash,
        selectedDiagnosis: prepared.selectedDiagnosis,
        selectedDiagnosisJson: prepared.selectedDiagnosisJson,
        selectedCounterfactual: prepared.selectedCounterfactual,
        selectedCounterfactualJson: prepared.selectedCounterfactualJson,
        artifactRows,
        now: now.toISOString(),
      });
      const stored = await this.investigations.get(ownerId, id);
      return saveInvestigationResponseSchema.parse({
        saved: savedDetail(stored),
        duplicate: duplicate.duplicate,
        warnings: [
          ...(promotion.warning ? [promotion.warning] : []),
          ...(duplicate.duplicate
            ? ["An identical evidence snapshot was already saved; this separate entry was kept."]
            : []),
        ],
      });
    } catch (error) {
      await rollbackPromotions(this.env.BROWSER_ARTIFACTS, artifactRows);
      throw error;
    }
  }

  list(ownerId: string, input: Omit<Parameters<InvestigationRepository["list"]>[0], "ownerId">) {
    return this.investigations.list({ ...input, ownerId });
  }

  async get(ownerId: string, id: string) {
    return savedDetail(await this.investigations.get(ownerId, id));
  }

  async rename(ownerId: string, id: string, title: string) {
    await this.investigations.rename(ownerId, id, title, this.now().toISOString());
    return this.get(ownerId, id);
  }

  async delete(ownerId: string, id: string) {
    const rows = await this.investigations.artifactRows(ownerId, id);
    const deleted = await this.investigations.delete(ownerId, id);
    if (!deleted) return;
    if (this.env.BROWSER_ARTIFACTS && rows.length) {
      try {
        await this.env.BROWSER_ARTIFACTS.delete(rows.map((row) => row.r2_key));
      } catch {
        for (const row of rows) {
          await this.investigations.recordCleanupFailure(row.r2_key, this.now().toISOString());
        }
        logEvent("error", "saved_artifact.delete_cleanup_failed", {
          savedInvestigationId: id,
          artifactCount: rows.length,
        });
      }
    }
  }

  async ownerArtifact(ownerId: string, investigationId: string, artifactId: string) {
    const rows = await this.investigations.artifactRows(ownerId, investigationId);
    return retrieveSavedArtifact(
      this.env.BROWSER_ARTIFACTS,
      rows.find((row) => row.artifact_id === artifactId),
      this.now(),
    );
  }

  async createShare(ownerId: string, investigationId: string, input: unknown) {
    const options = shareOptionsSchema.parse(input);
    if (
      options.expiresAt &&
      (Date.parse(options.expiresAt) <= this.now().getTime() ||
        Date.parse(options.expiresAt) - this.now().getTime() >
          PERSISTENCE_LIMITS.maximumShareLifetimeMs)
    ) {
      throw new PersistenceError(
        400,
        "invalid_saved_investigation",
        "Share expiration must be in the future and within 30 days.",
      );
    }
    const token = randomToken();
    const id = crypto.randomUUID();
    const row = await this.shares.create({
      id,
      investigationId,
      ownerId,
      tokenHash: await sha256Hex(token),
      options,
      now: this.now().toISOString(),
    });
    return createShareResponseSchema.parse({
      share: {
        id: row.id,
        createdAt: row.created_at,
        ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
        accessCount: 0,
        options: {
          includeAiDiagnosis: row.include_ai_diagnosis === 1,
          includeCounterfactual: row.include_counterfactual === 1,
          includeScreenshot: row.include_screenshot === 1,
        },
      },
      token,
      path: `/shared/${token}`,
    });
  }

  listShares(ownerId: string, investigationId: string) {
    return this.shares.list(ownerId, investigationId);
  }

  revokeShare(ownerId: string, investigationId: string, shareId: string) {
    return this.shares.revoke(ownerId, investigationId, shareId, this.now().toISOString());
  }

  async sharedReport(token: string) {
    if (!isValidOpaqueToken(token)) {
      throw new PersistenceError(404, "share_unavailable", "This shared report is unavailable.");
    }
    const share = await this.shares.resolve(await sha256Hex(token), this.now().toISOString());
    const ownerId = await this.shares.ownerIdForInvestigation(share.investigation_id);
    const stored = await this.investigations.get(ownerId, share.investigation_id);
    return sharedProjection(stored, share, token);
  }

  async sharedArtifact(token: string, artifactId: string) {
    if (!isValidOpaqueToken(token)) {
      throw new PersistenceError(404, "share_unavailable", "Artifact not found.");
    }
    const share = await this.shares.resolve(await sha256Hex(token), this.now().toISOString());
    if (!share.include_screenshot) {
      throw new PersistenceError(404, "share_unavailable", "Artifact not found.");
    }
    const ownerId = await this.shares.ownerIdForInvestigation(share.investigation_id);
    const rows = await this.investigations.artifactRows(ownerId, share.investigation_id);
    return retrieveSavedArtifact(
      this.env.BROWSER_ARTIFACTS,
      rows.find((row) => row.artifact_id === artifactId),
      this.now(),
    );
  }
}
