import { responseHeaders } from "./cors";
import type { Env } from "./env";
import { errorResponse } from "./errors";

export function routeRequest(request: Request, env: Env): Response {
  const url = new URL(request.url);
  const headers = responseHeaders(request, env);

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

  if (url.pathname === "/health" && request.method === "GET") {
    return Response.json(
      { status: "ok", service: "packet-journey-api", environment: env.ENVIRONMENT ?? "unknown" },
      { headers },
    );
  }

  return errorResponse(
    { code: "not_found", message: "Route not found.", retryable: false },
    404,
    headers,
  );
}
