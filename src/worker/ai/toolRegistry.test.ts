// @vitest-environment node
import { describe, expect, it } from "vitest";
import { investigationById } from "../../data/investigations";
import { executeAiToolCalls, modelToolDefinitions } from "./toolRegistry";

describe("restricted AI tool registry", () => {
  it("exposes only fixed read-only investigation tools", () => {
    const tools = modelToolDefinitions();
    const names = tools.map((tool) => tool.function.name);
    expect(names).toContain("get_stage_evidence");
    expect(names).not.toContain("fetch");
    expect(names).not.toContain("run_code");
    expect(tools[0]).toMatchObject({
      type: "function",
      function: {
        name: "get_investigation_summary",
        parameters: { type: "object" },
      },
    });
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

  it("treats a model-supplied null optional limit as omitted", () => {
    const [result] = executeAiToolCalls({
      investigation: investigationById.get("fast-cached")!,
      calls: [{ id: "one", name: "get_tls_evidence", arguments: { limit: null } }],
      maximumCalls: 1,
    });
    expect(result?.name).toBe("get_tls_evidence");
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
