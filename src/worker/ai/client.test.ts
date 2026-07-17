// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { investigationById } from "../../data/investigations";
import { readAiRuntimeConfig } from "./config";
import { WorkersAiClient } from "./client";
import { selectInvestigationEvidence } from "./evidenceSelection";
import { inconclusiveDraft } from "./fixture";

describe("Workers AI client", () => {
  const config = readAiRuntimeConfig({ ENVIRONMENT: "test" });
  const context = selectInvestigationEvidence({
    investigation: investigationById.get("fast-cached")!,
    question: "Why was this response cached?",
    expertiseMode: "developer",
  });

  it("normalizes traditional function calls and sends Gateway controls", async () => {
    const run = vi.fn().mockResolvedValue({
      tool_calls: [{ name: "get_cache_evidence", arguments: { limit: 4 } }],
      usage: { prompt_tokens: 20, completion_tokens: 3 },
    });
    const client = new WorkersAiClient({ run, aiGatewayLogId: "log-1" });
    const result = await client.plan({
      question: "Why was this response cached?",
      context,
      config,
    });
    expect(result.toolCalls[0]?.name).toBe("get_cache_evidence");
    expect(run.mock.calls[0]?.[2]).toMatchObject({
      gateway: { id: "default", skipCache: true, collectLog: true },
    });
  });

  it("parses JSON-mode model output", async () => {
    const draft = inconclusiveDraft("The evidence cannot establish a cause.");
    const client = new WorkersAiClient({
      run: vi.fn().mockResolvedValue({ response: JSON.stringify(draft) }),
    });
    const result = await client.diagnose({
      question: "Why is this page slow?",
      context,
      toolResults: [],
      config,
    });
    expect(result.output).toEqual(draft);
  });

  it.each([
    ["AI Gateway unavailable", "gateway_failed"],
    ["429 rate limit", "rate_limited"],
  ])("classifies %s without leaking provider output", async (message, code) => {
    const client = new WorkersAiClient({ run: vi.fn().mockRejectedValue(new Error(message)) });
    await expect(
      client.plan({ question: "Why was this response cached?", context, config }),
    ).rejects.toMatchObject({ code });
  });

  it("applies a bounded model timeout", async () => {
    const client = new WorkersAiClient({
      run: (_model, _input, options) =>
        new Promise((_resolve, reject) => {
          const signal = options?.signal as AbortSignal;
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    });
    await expect(
      client.plan({
        question: "Why was this response cached?",
        context,
        config: { ...config, modelTimeoutMs: 5 },
      }),
    ).rejects.toMatchObject({ code: "timeout" });
  });
});
