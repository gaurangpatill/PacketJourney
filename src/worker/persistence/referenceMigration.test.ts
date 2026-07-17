// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../../migrations/0002_reference_provenance.sql", import.meta.url),
  "utf8",
);

describe("reference provenance migration", () => {
  it("stores normalized corpus content and immutable diagnosis snapshots", () => {
    for (const table of [
      "reference_sources",
      "reference_chunks",
      "diagnosis_reference_runs",
      "diagnosis_reference_citations",
    ])
      expect(migration).toContain(`CREATE TABLE ${table}`);
    expect(migration).toContain("frozen_excerpt TEXT NOT NULL");
    expect(migration).toContain("embedding_model TEXT NOT NULL");
    expect(migration).toContain("index_version TEXT NOT NULL");
    expect(migration).toContain("corpus_version TEXT NOT NULL");
    expect(migration.match(/ON DELETE CASCADE/g)).toHaveLength(3);
  });
});
