import type { Env } from "../env";

export const AI_PROMPT_VERSION = "packet-journey-ai-v1";

export const AI_MODEL_REGISTRY = {
  "gpt-oss-20b": {
    id: "@cf/openai/gpt-oss-20b",
    contextTokens: 128_000,
    structuredOutput: true,
    functionCalling: true,
  },
  "llama-3.3-70b-fast": {
    id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    contextTokens: 24_000,
    structuredOutput: true,
    functionCalling: true,
  },
  "granite-micro": {
    id: "@cf/ibm-granite/granite-4.0-h-micro",
    contextTokens: 131_000,
    structuredOutput: true,
    functionCalling: true,
  },
} as const;

export type AiModelKey = keyof typeof AI_MODEL_REGISTRY;

export interface AiRuntimeConfig {
  enabled: boolean;
  fixtureMode: boolean;
  modelKey: AiModelKey;
  model: string;
  plannerModelKey: AiModelKey;
  plannerModel: string;
  fallbackModel?: string;
  gatewayId: string;
  maximumModelRequests: number;
  maximumToolRounds: number;
  maximumToolsPerRound: number;
  maximumTotalToolCalls: number;
  maximumInputCharacters: number;
  maximumOutputCharacters: number;
  maximumOutputTokens: number;
  modelTimeoutMs: number;
}

function modelKey(value: string | undefined): AiModelKey {
  return value && value in AI_MODEL_REGISTRY ? (value as AiModelKey) : "granite-micro";
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function readAiRuntimeConfig(env: Env): AiRuntimeConfig {
  const selectedKey = modelKey(env.AI_MODEL);
  const plannerKey =
    env.AI_PLANNER_MODEL && env.AI_PLANNER_MODEL in AI_MODEL_REGISTRY
      ? (env.AI_PLANNER_MODEL as AiModelKey)
      : "granite-micro";
  const fallbackKey =
    env.AI_FALLBACK_MODEL && env.AI_FALLBACK_MODEL in AI_MODEL_REGISTRY
      ? (env.AI_FALLBACK_MODEL as AiModelKey)
      : undefined;
  const fixtureMode =
    env.AI_FIXTURE_MODE === "true" &&
    (env.ENVIRONMENT === "development" || env.ENVIRONMENT === "test");
  return {
    enabled: env.AI_ENABLED !== "false",
    fixtureMode,
    modelKey: selectedKey,
    model: AI_MODEL_REGISTRY[selectedKey].id,
    plannerModelKey: plannerKey,
    plannerModel: AI_MODEL_REGISTRY[plannerKey].id,
    fallbackModel: fallbackKey ? AI_MODEL_REGISTRY[fallbackKey].id : undefined,
    gatewayId: (env.AI_GATEWAY_ID || "default").slice(0, 80),
    maximumModelRequests: boundedInteger(env.AI_MAX_REQUESTS, 2, 1, 3),
    maximumToolRounds: boundedInteger(env.AI_MAX_TOOL_ROUNDS, 1, 0, 2),
    maximumToolsPerRound: 4,
    maximumTotalToolCalls: 4,
    maximumInputCharacters: boundedInteger(env.AI_MAX_INPUT_CHARS, 18_000, 4_000, 40_000),
    maximumOutputCharacters: boundedInteger(env.AI_MAX_OUTPUT_CHARS, 12_000, 2_000, 24_000),
    maximumOutputTokens: boundedInteger(env.AI_MAX_OUTPUT_TOKENS, 1_400, 256, 2_400),
    modelTimeoutMs: boundedInteger(env.AI_TIMEOUT_MS, 45_000, 2_000, 45_000),
  };
}
