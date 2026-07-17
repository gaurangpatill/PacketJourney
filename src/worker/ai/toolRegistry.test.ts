// @vitest-environment node
import { describe, expect, it } from "vitest";
import { investigationById } from "../../data/investigations";
import { executeAiToolCalls, modelToolDefinitions } from "./toolRegistry";

describe("restricted AI tool registry", () => {
  it("exposes only fixed read-only investigation tools", () => {
    const names = modelToolDefinitions().map((tool) => tool.name);
    expect(names).toContain("get_stage_evidence");
    expect(names).not.toContain("fetch");
    expect(names).not.toContain("run_code");
  });

  it("executes a bounded stage lookup", () => {
    const [result] = executeAiToolCalls({
      investigation: investigationById.get("fast-cached")!,
      calls: [{ id: "one", name: "get_stage_evidence", arguments: { stageId: "dns", limit: 2 } }],
      maximumCalls: 2,
    });
    expect(result?.name).toBe("get_stage_evidence");
    expect(result?.serializedCharacters).toBeLessThan(6_000);
  });

  it("rejects unknown tools, missing stages, and duplicate calls", () => {
    const investigation = investigationById.get("fast-cached")!;
    expect(() =>
      executeAiToolCalls({
        investigation,
        calls: [{ id: "x", name: "fetch_url", arguments: {} }],
        maximumCalls: 1,
      }),
    ).toThrow(/not approved/i);
    expect(() =>
      executeAiToolCalls({
        investigation,
        calls: [{ id: "x", name: "get_stage_evidence", arguments: { stageId: "missing" } }],
        maximumCalls: 1,
      }),
    ).toThrow(/not in this investigation/i);
    expect(() =>
      executeAiToolCalls({
        investigation,
        calls: [
          { id: "a", name: "get_cache_evidence", arguments: {} },
          { id: "b", name: "get_cache_evidence", arguments: {} },
        ],
        maximumCalls: 2,
      }),
    ).toThrow(/Duplicate/i);
  });
});
