import { describe, expect, it, vi } from "vitest";
import { InvestigationRepository } from "./repositories/investigations";

function databaseReturningNoRows() {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const database = {
    prepare(sql: string) {
      const entry = { sql, values: [] as unknown[] };
      statements.push(entry);
      return {
        bind(...values: unknown[]) {
          entry.values = values;
          return this;
        },
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
      };
    },
    batch: vi.fn().mockResolvedValue([]),
  };
  return { database: database as unknown as D1Database, statements };
}

describe("D1 ownership boundaries", () => {
  it("binds both record and owner IDs for detail reads", async () => {
    const { database, statements } = databaseReturningNoRows();
    const repository = new InvestigationRepository(database);
    await expect(repository.get("owner-a", "saved-a")).rejects.toMatchObject({
      publicError: { code: "saved_investigation_not_found" },
    });
    expect(statements[0]?.sql).toContain("id = ?1 AND owner_id = ?2");
    expect(statements[0]?.values).toEqual(["saved-a", "owner-a"]);
  });

  it("uses prepared bindings and neutral behavior for cross-owner deletes", async () => {
    const { database, statements } = databaseReturningNoRows();
    const repository = new InvestigationRepository(database);
    await expect(repository.delete("owner-b", "saved-a")).resolves.toBe(false);
    expect(statements[0]?.sql).toContain("owner_id = ?2");
    expect(statements[0]?.values).toEqual(["saved-a", "owner-b"]);
  });
});
