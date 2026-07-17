import {
  createHttpInvestigationRequestSchema,
  httpInvestigationResponseSchema,
  type InvestigationApiError,
} from "../features/investigation/httpApi";
import { adaptHttpDiagnosticToInvestigation } from "./adapters/investigation";
import { responseHeaders } from "./cors";
import { traceHttpRedirects, type DiagnosticFetch } from "./diagnostics/redirects";
import type { DiagnosticError } from "./diagnostics/types";
import type { Env } from "./env";
import { readRuntimeLimits } from "./env";
import { errorResponse, WorkerError } from "./errors";
import { logEvent } from "./logging";
import { type AddressResolver, CloudflareDohResolver } from "./security/dns";
import { SsrfPolicyError } from "./security/ssrf";
import { UrlPolicyError } from "./security/url";

const INVESTIGATION_PATH = "/api/v1/investigations/http";
const MAX_REQUEST_BODY_LENGTH = 4_096;

export interface RouterDependencies {
  resolver?: AddressResolver;
  targetFetch?: DiagnosticFetch;
  investigationId?: () => string;
}

function requestError(message: string): WorkerError {
  return new WorkerError(400, {
    code: "invalid_request",
    message,
    retryable: false,
  });
}

async function readRequestBody(request: Request): Promise<unknown> {
  const declaredLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (declaredLength > MAX_REQUEST_BODY_LENGTH) {
    throw requestError("The request body exceeds the allowed size.");
  }

  const text = await request.text();
  if (text.length > MAX_REQUEST_BODY_LENGTH) {
    throw requestError("The request body exceeds the allowed size.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw requestError("The request body must be valid JSON.");
  }
}

function partialError(error: DiagnosticError | undefined): InvestigationApiError | undefined {
  if (!error) return undefined;
  let code = "upstream_error";
  if (error.code === "request_timeout") code = "timeout";
  if (error.code === "blocked_redirect_destination") code = "blocked_destination";
  if (error.code === "invalid_redirect_destination") code = "invalid_url";

  return {
    code,
    message: error.message,
    stage: error.stage,
    retryable: error.retryable,
    details: { diagnosticCode: error.code, ...error.details },
  };
}

function knownErrorResponse(error: unknown, headers: Headers): Response | undefined {
  if (error instanceof WorkerError) {
    return errorResponse(error.publicError, error.status, headers);
  }
  if (error instanceof UrlPolicyError) {
    return errorResponse(
      {
        code: "invalid_url",
        message: error.message,
        retryable: false,
        details: { reason: error.code },
      },
      400,
      headers,
    );
  }
  if (error instanceof SsrfPolicyError) {
    return errorResponse(
      {
        code: "blocked_destination",
        message: error.message,
        retryable: error.retryable,
        details: { reason: error.code, ...error.details },
      },
      403,
      headers,
    );
  }
  return undefined;
}

export function createRouter(dependencies: RouterDependencies = {}) {
  const resolver = dependencies.resolver ?? new CloudflareDohResolver();

  return async function routeRequest(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const headers = responseHeaders(request, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    if (url.pathname === "/health" && request.method === "GET") {
      return Response.json(
        {
          status: "ok",
          service: "packet-journey-api",
          environment: env.ENVIRONMENT ?? "unknown",
        },
        { headers },
      );
    }

    if (url.pathname === INVESTIGATION_PATH) {
      if (request.method !== "POST") {
        headers.set("allow", "POST, OPTIONS");
        return errorResponse(
          {
            code: "method_not_allowed",
            message: "Use POST to create an HTTP investigation.",
            retryable: false,
          },
          405,
          headers,
        );
      }

      try {
        if (env.HTTP_INVESTIGATION_RATE_LIMITER) {
          const key = request.headers.get("cf-connecting-ip") ?? "unidentified-client";
          const rateLimit = await env.HTTP_INVESTIGATION_RATE_LIMITER.limit({
            key: `${INVESTIGATION_PATH}:${key}`,
          });
          if (!rateLimit.success) {
            logEvent("warn", "investigation.rate_limited");
            return errorResponse(
              {
                code: "rate_limited",
                message: "Too many live investigations were requested. Try again shortly.",
                retryable: true,
              },
              429,
              headers,
            );
          }
        }

        const body = await readRequestBody(request);
        const parsedRequest = createHttpInvestigationRequestSchema.safeParse(body);
        if (!parsedRequest.success) {
          throw requestError("Provide a JSON object with one non-empty URL string.");
        }

        const diagnostic = await traceHttpRedirects(
          parsedRequest.data.url,
          readRuntimeLimits(env),
          {
            resolver,
            fetcher: dependencies.targetFetch,
          },
        );
        const investigation = adaptHttpDiagnosticToInvestigation(diagnostic, {
          id: dependencies.investigationId?.(),
        });
        const payload = httpInvestigationResponseSchema.parse({
          investigation,
          partialError: partialError(diagnostic.error),
        });
        logEvent(diagnostic.error ? "warn" : "info", "investigation.completed", {
          investigationId: investigation.id,
          status: investigation.status,
          redirectCount: diagnostic.redirects.length,
          finalStatus: diagnostic.finalResponse?.status,
          diagnosticError: diagnostic.error?.code,
        });
        return Response.json(payload, { status: 200, headers });
      } catch (error) {
        const response = knownErrorResponse(error, headers);
        if (response) return response;
        throw error;
      }
    }

    return errorResponse(
      { code: "not_found", message: "Route not found.", retryable: false },
      404,
      headers,
    );
  };
}

export const routeRequest = createRouter();
