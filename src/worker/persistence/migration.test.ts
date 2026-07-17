// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../../migrations/0001_persistence.sql", import.meta.url),
  "utf8",
);

describe("D1 persistence migration", () => {
  it("creates all bounded persistence tables with foreign-key cascades", () => {
    for (const table of [
      "investigations",
      "ai_diagnoses",
      "counterfactual_results",
      "share_links",
      "investigation_artifacts",
      "artifact_cleanup_failures",
    ]) {
      expect(migration).toContain(`CREATE TABLE ${table}`);
    }
    expect(migration.match(/ON DELETE CASCADE/g)).toHaveLength(4);
    expect(migration).toContain("PRAGMA foreign_keys = ON");
  });

  it("indexes owner history, duplicate hashes, shares, and artifact expiry", () => {
    expect(migration).toContain("idx_investigations_owner_updated");
    expect(migration).toContain("idx_investigations_owner_hash");
    expect(migration).toContain("idx_share_links_token_active");
    expect(migration).toContain("idx_investigation_artifacts_expiry");
  });

  it("stores only a share token hash column", () => {
    const shareTable = migration.slice(
      migration.indexOf("CREATE TABLE share_links"),
      migration.indexOf("CREATE INDEX idx_share_links"),
    );
    expect(shareTable).toContain("token_hash TEXT NOT NULL UNIQUE");
    expect(shareTable).not.toMatch(/\btoken\s+TEXT/i);
  });
});
