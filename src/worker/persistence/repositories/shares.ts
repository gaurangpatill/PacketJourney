import { databaseFailure, PersistenceError } from "../errors";
import { PERSISTENCE_LIMITS } from "../limits";
import { shareSummary, type CreateShareInput, type ShareRow } from "../types";

export class ShareRepository {
  constructor(private readonly database: D1Database) {}

  async create(input: CreateShareInput): Promise<ShareRow> {
    try {
      const owner = await this.database
        .prepare("SELECT id FROM investigations WHERE id = ?1 AND owner_id = ?2")
        .bind(input.investigationId, input.ownerId)
        .first<{ id: string }>();
      if (!owner) {
        throw new PersistenceError(
          404,
          "saved_investigation_not_found",
          "Saved investigation not found.",
        );
      }
      const count = await this.database
        .prepare(
          "SELECT COUNT(*) AS count FROM share_links WHERE investigation_id = ?1 AND revoked_at IS NULL",
        )
        .bind(input.investigationId)
        .first<{ count: number }>();
      if ((count?.count ?? 0) >= PERSISTENCE_LIMITS.maximumSharesPerInvestigation) {
        throw new PersistenceError(
          409,
          "share_limit_exceeded",
          "This investigation has reached its active-share limit.",
        );
      }
      await this.database
        .prepare(
          `INSERT INTO share_links (
            id, investigation_id, token_hash, include_ai_diagnosis, include_counterfactual,
            include_screenshot, created_at, expires_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
        )
        .bind(
          input.id,
          input.investigationId,
          input.tokenHash,
          input.options.includeAiDiagnosis ? 1 : 0,
          input.options.includeCounterfactual ? 1 : 0,
          input.options.includeScreenshot ? 1 : 0,
          input.now,
          input.options.expiresAt ?? null,
        )
        .run();
      return {
        id: input.id,
        investigation_id: input.investigationId,
        token_hash: input.tokenHash,
        include_ai_diagnosis: input.options.includeAiDiagnosis ? 1 : 0,
        include_counterfactual: input.options.includeCounterfactual ? 1 : 0,
        include_screenshot: input.options.includeScreenshot ? 1 : 0,
        created_at: input.now,
        expires_at: input.options.expiresAt ?? null,
        revoked_at: null,
        last_accessed_at: null,
        access_count: 0,
      };
    } catch (error) {
      if (error instanceof PersistenceError) throw error;
      throw databaseFailure();
    }
  }

  async list(ownerId: string, investigationId: string) {
    try {
      const result = await this.database
        .prepare(
          `SELECT s.* FROM share_links s
           INNER JOIN investigations i ON i.id = s.investigation_id
           WHERE s.investigation_id = ?1 AND i.owner_id = ?2
           ORDER BY s.created_at DESC, s.id DESC
           LIMIT ?3`,
        )
        .bind(investigationId, ownerId, PERSISTENCE_LIMITS.maximumSharesPerInvestigation)
        .all<ShareRow>();
      return result.results.map(shareSummary);
    } catch {
      throw databaseFailure();
    }
  }

  async revoke(ownerId: string, investigationId: string, shareId: string, now: string) {
    try {
      await this.database
        .prepare(
          `UPDATE share_links SET revoked_at = COALESCE(revoked_at, ?1)
           WHERE id = ?2 AND investigation_id = ?3
             AND EXISTS (
               SELECT 1 FROM investigations i WHERE i.id = share_links.investigation_id AND i.owner_id = ?4
             )`,
        )
        .bind(now, shareId, investigationId, ownerId)
        .run();
    } catch {
      throw databaseFailure();
    }
  }

  async resolve(tokenHash: string, now: string): Promise<ShareRow> {
    let row: ShareRow | null;
    try {
      row = await this.database
        .prepare("SELECT * FROM share_links WHERE token_hash = ?1")
        .bind(tokenHash)
        .first<ShareRow>();
    } catch {
      throw databaseFailure();
    }
    if (!row) {
      throw new PersistenceError(404, "share_unavailable", "This shared report is unavailable.");
    }
    if (row.revoked_at) {
      throw new PersistenceError(410, "share_revoked", "This shared report was revoked.");
    }
    if (row.expires_at && Date.parse(row.expires_at) <= Date.parse(now)) {
      throw new PersistenceError(410, "share_expired", "This shared report has expired.");
    }
    try {
      await this.database
        .prepare(
          "UPDATE share_links SET access_count = access_count + 1, last_accessed_at = ?1 WHERE id = ?2",
        )
        .bind(now, row.id)
        .run();
    } catch {
      throw databaseFailure();
    }
    return { ...row, access_count: row.access_count + 1, last_accessed_at: now };
  }

  async ownerIdForInvestigation(investigationId: string): Promise<string> {
    try {
      const row = await this.database
        .prepare("SELECT owner_id FROM investigations WHERE id = ?1")
        .bind(investigationId)
        .first<{ owner_id: string }>();
      if (!row) {
        throw new PersistenceError(404, "share_unavailable", "This shared report is unavailable.");
      }
      return row.owner_id;
    } catch (error) {
      if (error instanceof PersistenceError) throw error;
      throw databaseFailure();
    }
  }
}
