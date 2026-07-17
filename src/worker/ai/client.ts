import type { AiModelDiagnosisResult, AiModelUsage, AiPlanningResult, AiToolCall } from "./types";
import type { AiRuntimeConfig } from "./config";
import type { InvestigationEvidenceContext, AiToolResult } from "./types";
import { DIAGNOSIS_JSON_SCHEMA, diagnosisMessages, planningMessages } from "./prompts";
import { modelToolDefinitions } from "./toolRegistry";

export interface InvestigationAiClient {
  plan(input: {
    question: string;
    context: InvestigationEvidenceContext;
    config: AiRuntimeConfig;
  }): Promise<AiPlanningResult>;
  diagnose(input: {
    question: string;
    context: InvestigationEvidenceContext;
    toolResults: AiToolResult[];
    config: AiRuntimeConfig;
  }): Promise<AiModelDiagnosisResult>;
}

export interface WorkersAiBindingLike {
  run(
    model: string,
    input: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
  aiGatewayLogId?: string | null;
}

export class AiModelError extends Error {
  constructor(
    readonly code:
      "timeout" | "invalid_response" | "inference_failed" | "gateway_failed" | "rate_limited",
    message: string,
  ) {
    super(message);
    this.name = "AiModelError";
  }
}

function usage(value: unknown): AiModelUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const root = value as Record<string, unknown>;
  const candidate =
    root.usage && typeof root.usage === "object" ? (root.usage as Record<string, unknown>) : root;
  const integer = (key: string) =>
    typeof candidate[key] === "number" && Number.isInteger(candidate[key])
      ? candidate[key]
      : undefined;
  const result = {
    promptTokens: integer("prompt_tokens") ?? integer("promptTokens"),
    completionTokens: integer("completion_tokens") ?? integer("completionTokens"),
    totalTokens: integer("total_tokens") ?? integer("totalTokens"),
  };
  return Object.values(result).some((item) => item !== undefined) ? result : undefined;
}

function toolCalls(value: unknown): AiToolCall[] {
  if (!value || typeof value !== "object") return [];
  const root = value as Record<string, unknown>;
  const raw = Array.isArray(root.tool_calls)
    ? root.tool_calls
    : Array.isArray(root.toolCalls)
      ? root.toolCalls
      : [];
  return raw.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const call = item as Record<string, unknown>;
    const fn =
      call.function && typeof call.function === "object"
        ? (call.function as Record<string, unknown>)
        : call;
    if (typeof fn.name !== "string") return [];
    let args: unknown = fn.arguments ?? {};
    if (typeof args === "string") {
      try {
        args = JSON.parse(args) as unknown;
      } catch {
        throw new AiModelError("invalid_response", "The model returned malformed tool arguments.");
      }
    }
    return [
      {
        id: typeof call.id === "string" ? call.id : `tool-${index}`,
        name: fn.name,
        arguments: args,
      },
    ];
  });
}

function parseModelOutput(value: unknown, maximumCharacters: number) {
  const root = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  const candidate = root && "response" in root ? root.response : value;
  if (typeof candidate === "string") {
    if (candidate.length > maximumCharacters) {
      throw new AiModelError("invalid_response", "The model output exceeded its size limit.");
    }
    try {
      return { output: JSON.parse(candidate) as unknown, rawCharacters: candidate.length };
    } catch {
      throw new AiModelError("invalid_response", "The model did not return valid JSON.");
    }
  }
  const serialized = JSON.stringify(candidate);
  if (!serialized || serialized.length > maximumCharacters) {
    throw new AiModelError(
      "invalid_response",
      "The model output was empty or exceeded its size limit.",
    );
  }
  return { output: candidate, rawCharacters: serialized.length };
}

export class WorkersAiClient implements InvestigationAiClient {
  constructor(private readonly binding: WorkersAiBindingLike) {}

  private async run(model: string, input: Record<string, unknown>, config: AiRuntimeConfig) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.modelTimeoutMs);
    try {
      return await this.binding.run(model, input, {
        signal: controller.signal,
        gateway: {
          id: config.gatewayId,
          skipCache: true,
          collectLog: true,
          metadata: { promptVersion: "packet-journey-ai-v1", modelKey: config.modelKey },
          requestTimeoutMs: config.modelTimeoutMs,
          retries: { maxAttempts: 1 },
        },
      });
    } catch (error) {
      if (controller.signal.aborted) throw new AiModelError("timeout", "AI inference timed out.");
      const message = error instanceof Error ? error.message : "";
      if (/rate.?limit|too many requests|\b429\b/i.test(message)) {
        throw new AiModelError("rate_limited", "Workers AI rate limited this diagnosis.");
      }
      if (/gateway/i.test(message)) {
        throw new AiModelError("gateway_failed", "AI Gateway could not complete this diagnosis.");
      }
      throw new AiModelError("inference_failed", "Workers AI inference was unavailable.");
    } finally {
      clearTimeout(timeout);
    }
  }

  async plan(input: {
    question: string;
    context: InvestigationEvidenceContext;
    config: AiRuntimeConfig;
  }): Promise<AiPlanningResult> {
    const output = await this.run(
      input.config.model,
      {
        messages: planningMessages(input.question, input.context),
        tools: modelToolDefinitions(),
        temperature: 0,
        max_tokens: 400,
      },
      input.config,
    );
    return {
      toolCalls: toolCalls(output),
      usage: usage(output),
      ...(this.binding.aiGatewayLogId ? { gatewayLogId: this.binding.aiGatewayLogId } : {}),
    };
  }

  async diagnose(input: {
    question: string;
    context: InvestigationEvidenceContext;
    toolResults: AiToolResult[];
    config: AiRuntimeConfig;
  }): Promise<AiModelDiagnosisResult> {
    const output = await this.run(
      input.config.model,
      {
        messages: diagnosisMessages(input),
        temperature: 0,
        max_tokens: input.config.maximumOutputTokens,
        response_format: {
          type: "json_schema",
          json_schema: DIAGNOSIS_JSON_SCHEMA,
        },
      },
      input.config,
    );
    const parsed = parseModelOutput(output, input.config.maximumOutputCharacters);
    return {
      ...parsed,
      usage: usage(output),
      ...(this.binding.aiGatewayLogId ? { gatewayLogId: this.binding.aiGatewayLogId } : {}),
    };
  }
}
