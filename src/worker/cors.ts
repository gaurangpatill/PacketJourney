import type { Env } from "./env";

const BASE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
} as const;

function configuredOrigins(env: Env): Set<string> {
  return new Set(
    (env.CORS_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

export function responseHeaders(request: Request, env: Env): Headers {
  const headers = new Headers(BASE_HEADERS);
  const origin = request.headers.get("origin");
  if (origin && configuredOrigins(env).has(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", "POST, OPTIONS");
    headers.set("access-control-allow-headers", "content-type");
    headers.set("access-control-max-age", "86400");
    headers.set("vary", "Origin");
  }
  return headers;
}
