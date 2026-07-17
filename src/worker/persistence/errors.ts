import { WorkerError } from "../errors";

export class PersistenceError extends WorkerError {
  constructor(
    status: number,
    code:
      | "persistence_unavailable"
      | "invalid_saved_investigation"
      | "saved_investigation_not_found"
      | "duplicate_saved_investigation"
      | "serialization_too_large"
      | "unsupported_schema_version"
      | "share_unavailable"
      | "share_expired"
      | "share_revoked"
      | "share_limit_exceeded"
      | "artifact_promotion_failed"
      | "database_failure"
      | "migration_mismatch",
    message: string,
    retryable = false,
    details?: Record<string, unknown>,
  ) {
    super(status, { code, message, retryable, ...(details ? { details } : {}) });
    this.name = "PersistenceError";
  }
}

export function requireDatabase(database: D1Database | undefined): D1Database {
  if (!database) {
    throw new PersistenceError(
      503,
      "persistence_unavailable",
      "Saved investigations are unavailable because the D1 binding is not configured.",
      false,
    );
  }
  return database;
}

export function databaseFailure(): PersistenceError {
  return new PersistenceError(
    503,
    "database_failure",
    "The saved-investigation database could not complete this request.",
    true,
  );
}
