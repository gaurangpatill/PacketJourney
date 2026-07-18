import type { AiModelDiagnosisResult, AiModelUsage, AiPlanningResult, AiToolCall } from "./types";
import type { AiRuntimeConfig } from "./config";
import type { InvestigationEvidenceContext, AiToolResult } from "./types";
import { diagnosisMessages, planningMessages } from "./prompts";
import { modelToolDefinitions } from "./toolRegistry";
import type { ReferenceCitation } from "../../features/references/schema";
import { logEvent } from "../logging";

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
    references?: ReferenceCitation[];
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

function safeProviderErrorMessage(value: string): string {
  return [...value.replace(/Bearer\s+\S+/gi, "Bearer [redacted]")]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .slice(0, 600);
}

function parseJsonObjectText(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    const withoutFence = value
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    try {
      return JSON.parse(withoutFence) as unknown;
    } catch {
      const start = withoutFence.indexOf("{");
      const end = withoutFence.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(withoutFence.slice(start, end + 1)) as unknown;
        } catch {
          // The public error remains generic; provider text is never returned to the client.
        }
      }
      throw new AiModelError("invalid_response", "The model did not return valid JSON.");
    }
  }
}

function toolCalls(value: unknown): AiToolCall[] {
  if (!value || typeof value !== "object") return [];
  const root = value as Record<string, unknown>;
  const choices = Array.isArray(root.choices) ? (root.choices as unknown[]) : [];
  const firstChoice: unknown = choices[0];
  const choiceMessage =
    firstChoice && typeof firstChoice === "object"
      ? (firstChoice as Record<string, unknown>).message
      : undefined;
  const message =
    choiceMessage && typeof choiceMessage === "object"
      ? (choiceMessage as Record<string, unknown>)
      : undefined;
  const raw = Array.isArray(root.tool_calls)
    ? root.tool_calls
    : Array.isArray(root.toolCalls)
      ? root.toolCalls
      : Array.isArray(message?.tool_calls)
        ? message.tool_calls
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
    for (let depth = 0; depth < 2 && typeof args === "string"; depth += 1) {
      try {
        args = JSON.parse(args) as unknown;
      } catch {
        throw new AiModelError("invalid_response", "The model returned malformed tool arguments.");
      }
    }
    if (args === null) args = {};
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
  const result =
    root?.result && typeof root.result === "object"
      ? (root.result as Record<string, unknown>)
      : undefined;
  const choices = root && Array.isArray(root.choices) ? (root.choices as unknown[]) : [];
  const firstChoice: unknown = choices[0];
  const choiceMessage =
    firstChoice && typeof firstChoice === "object"
      ? (firstChoice as Record<string, unknown>).message
      : undefined;
  const messageContent =
    choiceMessage && typeof choiceMessage === "object"
      ? (choiceMessage as Record<string, unknown>).content
      : undefined;
  logEvent("info", "ai.response.envelope", {
    rootKeys: Object.keys(root ?? {}).slice(0, 16),
    resultKeys: Object.keys(result ?? {}).slice(0, 16),
    firstChoiceKeys:
      firstChoice && typeof firstChoice === "object" ? Object.keys(firstChoice).slice(0, 12) : [],
    messageKeys:
      choiceMessage && typeof choiceMessage === "object"
        ? Object.keys(choiceMessage).slice(0, 12)
        : [],
    responseType: typeof root?.response,
    messageContentType: typeof messageContent,
    messageContentLength: typeof messageContent === "string" ? messageContent.length : undefined,
    messageContentStartsWithObject:
      typeof messageContent === "string" ? messageContent.trimStart().startsWith("{") : undefined,
    messageContentEndsWithObject:
      typeof messageContent === "string" ? messageContent.trimEnd().endsWith("}") : undefined,
    finishReason:
      firstChoice && typeof firstChoice === "object"
        ? (firstChoice as Record<string, unknown>).finish_reason
        : undefined,
  });
  const candidate =
    root && "response" in root
      ? root.response
      : typeof messageContent === "string"
        ? messageContent
        : value;
  if (typeof candidate === "string") {
    if (candidate.length > maximumCharacters) {
      throw new AiModelError("invalid_response", "The model output exceeded its size limit.");
    }
    return { output: parseJsonObjectText(candidate), rawCharacters: candidate.length };
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

  private async run(
    model: string,
    input: Record<string, unknown>,
    config: AiRuntimeConfig,
    modelKey = config.modelKey,
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.modelTimeoutMs);
    try {
      return await this.binding.run(model, input, {
        signal: controller.signal,
        gateway: {
          id: config.gatewayId,
          skipCache: true,
          collectLog: true,
          metadata: { promptVersion: "packet-journey-ai-v1", modelKey },
          requestTimeoutMs: config.modelTimeoutMs,
          retries: { maxAttempts: 1 },
        },
      });
    } catch (error) {
      if (controller.signal.aborted) {
        logEvent("error", "ai.inference.timed_out", {
          model,
          gatewayId: config.gatewayId,
          timeoutMs: config.modelTimeoutMs,
        });
        throw new AiModelError("timeout", "AI inference timed out.");
      }
      const message = error instanceof Error ? error.message : "";
      logEvent("error", "ai.inference.provider_failed", {
        model,
        gatewayId: config.gatewayId,
        providerErrorName: error instanceof Error ? error.name : "UnknownError",
        providerErrorMessage: safeProviderErrorMessage(message),
      });
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
      input.config.plannerModel,
      {
        messages: planningMessages(input.question, input.context),
        tools: modelToolDefinitions(),
        temperature: 0,
        max_tokens: 400,
      },
      input.config,
      input.config.plannerModelKey,
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
    references?: ReferenceCitation[];
  }): Promise<AiModelDiagnosisResult> {
    const output = await this.run(
      input.config.model,
      {
        messages: diagnosisMessages(input),
        temperature: 0,
        max_tokens: input.config.maximumOutputTokens,
        response_format: {
          type: "json_object",
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
