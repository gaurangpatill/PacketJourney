import type { Env } from "./env";
import { errorResponse, WorkerError } from "./errors";
import { logEvent } from "./logging";
import { routeRequest } from "./router";

export default {
  fetch(request, env): Response {
    const requestId = crypto.randomUUID();
    const startedAt = performance.now();

    try {
      const response = routeRequest(request, env);
      logEvent("info", "request.completed", {
        requestId,
        method: request.method,
        path: new URL(request.url).pathname,
        status: response.status,
        durationMs: Math.round(performance.now() - startedAt),
      });
      response.headers.set("x-request-id", requestId);
      return response;
    } catch (error) {
      if (error instanceof WorkerError) {
        logEvent("warn", "request.rejected", {
          requestId,
          code: error.publicError.code,
          status: error.status,
        });
        return errorResponse(error.publicError, error.status, { "x-request-id": requestId });
      }

      logEvent("error", "request.failed", { requestId, errorName: getErrorName(error) });
      return errorResponse(
        {
          code: "internal_error",
          message: "The investigation service could not complete this request.",
          retryable: true,
        },
        500,
        { "x-request-id": requestId },
      );
    }
  },
} satisfies ExportedHandler<Env>;

function getErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
