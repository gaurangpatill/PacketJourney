export interface Env {
  ENVIRONMENT?: "development" | "preview" | "production" | "test";
  CORS_ALLOWED_ORIGINS?: string;
  HTTP_HOP_TIMEOUT_MS?: string;
  HTTP_OVERALL_TIMEOUT_MS?: string;
  HTTP_INVESTIGATION_RATE_LIMITER?: RateLimit;
  BROWSER_INVESTIGATION_RATE_LIMITER?: RateLimit;
  BROWSER?: Fetcher;
  BROWSER_ARTIFACTS?: R2Bucket;
  DB?: D1Database;
  SHARE_RESOLUTION_RATE_LIMITER?: RateLimit;
  DNS_TIMEOUT_MS?: string;
  CERTIFICATE_TIMEOUT_MS?: string;
  CERTSPOTTER_API_TOKEN?: string;
  BROWSER_ENABLED?: string;
  AI?: Ai;
  AI_ENABLED?: string;
  AI_FIXTURE_MODE?: string;
  AI_GATEWAY_ID?: string;
  AI_MODEL?: string;
  AI_FALLBACK_MODEL?: string;
  AI_MAX_REQUESTS?: string;
  AI_MAX_TOOL_ROUNDS?: string;
  AI_MAX_INPUT_CHARS?: string;
  AI_MAX_OUTPUT_CHARS?: string;
  AI_MAX_OUTPUT_TOKENS?: string;
  AI_TIMEOUT_MS?: string;
  AI_INVESTIGATION_RATE_LIMITER?: RateLimit;
  AI_INVESTIGATION_HASH_RATE_LIMITER?: RateLimit;
}

export interface RuntimeLimits {
  hopTimeoutMs: number;
  overallTimeoutMs: number;
  dnsTimeoutMs: number;
  certificateTimeoutMs: number;
  maximumDiagnosticHostnames: number;
  maximumCertificateInspections: number;
  investigationTimeoutMs: number;
}

const DEFAULT_HOP_TIMEOUT_MS = 8_000;
const DEFAULT_OVERALL_TIMEOUT_MS = 20_000;
const DEFAULT_DNS_TIMEOUT_MS = 5_000;
const DEFAULT_CERTIFICATE_TIMEOUT_MS = 8_000;

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
    dnsTimeoutMs: boundedInteger(env.DNS_TIMEOUT_MS, DEFAULT_DNS_TIMEOUT_MS, 10_000),
    certificateTimeoutMs: boundedInteger(
      env.CERTIFICATE_TIMEOUT_MS,
      DEFAULT_CERTIFICATE_TIMEOUT_MS,
      10_000,
    ),
    maximumDiagnosticHostnames: 3,
    maximumCertificateInspections: 3,
    investigationTimeoutMs: 30_000,
  };
}
