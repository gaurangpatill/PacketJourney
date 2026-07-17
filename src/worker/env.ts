export interface Env {
  ENVIRONMENT?: "development" | "preview" | "production" | "test";
  CORS_ALLOWED_ORIGINS?: string;
  HTTP_HOP_TIMEOUT_MS?: string;
  HTTP_OVERALL_TIMEOUT_MS?: string;
}

export interface RuntimeLimits {
  hopTimeoutMs: number;
  overallTimeoutMs: number;
}

const DEFAULT_HOP_TIMEOUT_MS = 8_000;
const DEFAULT_OVERALL_TIMEOUT_MS = 20_000;

function boundedInteger(value: string | undefined, fallback: number, maximum: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 250 || parsed > maximum) return fallback;
  return parsed;
}

export function readRuntimeLimits(env: Env): RuntimeLimits {
  return {
    hopTimeoutMs: boundedInteger(env.HTTP_HOP_TIMEOUT_MS, DEFAULT_HOP_TIMEOUT_MS, 15_000),
    overallTimeoutMs: boundedInteger(
      env.HTTP_OVERALL_TIMEOUT_MS,
      DEFAULT_OVERALL_TIMEOUT_MS,
      30_000,
    ),
  };
}
