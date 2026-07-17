import { z } from "zod";
import {
  renameSavedInvestigationRequestSchema,
  saveInvestigationRequestSchema,
  savedInvestigationDetailSchema,
  savedInvestigationListResponseSchema,
  shareListResponseSchema,
  shareOptionsSchema,
  sharedReportSchema,
} from "../../features/persistence/schema";
import type { Env } from "../env";
import { WorkerError, errorResponse } from "../errors";
import { logEvent } from "../logging";
import { PersistenceError } from "./errors";
import { PERSISTENCE_LIMITS } from "./limits";
import { resolveAnonymousOwner } from "./ownership";
import { PersistenceService } from "./service";

const ROOT = "/api/v1/saved-investigations";
const SHARED_ROOT = "/api/v1/shared-reports";
const ID = "([^/]+)";

function invalidRequest(message: string): WorkerError {
  return new WorkerError(400, {
    code: "invalid_request",
    message,
    retryable: false,
  });
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw invalidRequest("The resource identifier is malformed.");
  }
}

function resourceId(value: string): string {
  const decoded = decode(value);
  if (!z.string().uuid().safeParse(decoded).success) {
    throw invalidRequest("The resource identifier is invalid.");
  }
  return decoded;
}

async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw invalidRequest("The request Content-Type must be application/json.");
  }
  const declared = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (declared > PERSISTENCE_LIMITS.maximumRequestBytes) {
    throw new PersistenceError(
      413,
      "serialization_too_large",
      "The saved-investigation request exceeds the allowed size.",
    );
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > PERSISTENCE_LIMITS.maximumRequestBytes) {
    throw new PersistenceError(
      413,
      "serialization_too_large",
      "The saved-investigation request exceeds the allowed size.",
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw invalidRequest("The request body must be valid JSON.");
  }
}

function methodNotAllowed(methods: string, headers: Headers): Response {
  headers.set("allow", `${methods}, OPTIONS`);
  return errorResponse(
    {
      code: "method_not_allowed",
      message: `Use ${methods.replace(",", " or")} for this resource.`,
      retryable: false,
    },
    405,
    headers,
  );
}

function json(data: unknown, headers: Headers, status = 200): Response {
  return Response.json(data, { status, headers });
}

function applyCookie(headers: Headers, value: string | undefined) {
  if (value) headers.append("set-cookie", value);
}

function attachCors(response: Response, cors: Headers, cookie?: string): Response {
  for (const [name, value] of cors) {
    if (name.startsWith("access-control-") || name === "vary") {
      response.headers.set(name, value);
    }
  }
  if (cookie) response.headers.append("set-cookie", cookie);
  return response;
}

async function enforceShareRateLimit(request: Request, env: Env): Promise<void> {
  const limiter = env.SHARE_RESOLUTION_RATE_LIMITER ?? env.HTTP_INVESTIGATION_RATE_LIMITER;
  if (!limiter) return;
  const client = request.headers.get("cf-connecting-ip") ?? "unidentified-client";
  const result = await limiter.limit({ key: `shared-report:${client}` });
  if (!result.success) {
    logEvent("warn", "shared_report.rate_limited");
    throw new WorkerError(429, {
      code: "rate_limited",
      message: "Too many shared reports were requested. Try again shortly.",
      retryable: true,
    });
  }
}

function parseList(url: URL): {
  limit: number;
  cursor?: string;
  status?: "completed" | "failed";
  sourceType?: "live" | "recorded";
  hostname?: string;
} {
  const limitText = url.searchParams.get("limit");
  const limit = limitText ? Number.parseInt(limitText, 10) : PERSISTENCE_LIMITS.defaultPageSize;
  if (!Number.isInteger(limit) || limit < 1 || limit > PERSISTENCE_LIMITS.maximumPageSize) {
    throw invalidRequest(`limit must be between 1 and ${PERSISTENCE_LIMITS.maximumPageSize}.`);
  }
  const status = url.searchParams.get("status");
  const sourceType = url.searchParams.get("sourceType");
  const hostname = url.searchParams.get("hostname")?.trim().toLowerCase();
  if (status && status !== "completed" && status !== "failed") {
    throw invalidRequest("status must be completed or failed.");
  }
  if (sourceType && sourceType !== "live" && sourceType !== "recorded") {
    throw invalidRequest("sourceType must be live or recorded.");
  }
  if (hostname && (hostname.length > 253 || /[%_]/.test(hostname))) {
    throw invalidRequest("hostname must be a literal hostname fragment without wildcard syntax.");
  }
  return {
    limit,
    ...(url.searchParams.get("cursor") ? { cursor: url.searchParams.get("cursor")! } : {}),
    ...(status ? { status: status as "completed" | "failed" } : {}),
    ...(sourceType ? { sourceType: sourceType as "live" | "recorded" } : {}),
    ...(hostname ? { hostname } : {}),
  };
}

/** Returns undefined when the request belongs to a different API surface. */
export async function handlePersistenceRoute(
  request: Request,
  env: Env,
  headers: Headers,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(ROOT) && !url.pathname.startsWith(SHARED_ROOT)) {
    return undefined;
  }

  try {
    const service = new PersistenceService(env);

    const sharedArtifact = url.pathname.match(new RegExp(`^${SHARED_ROOT}/${ID}/artifacts/${ID}$`));
    if (sharedArtifact) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return methodNotAllowed("GET, HEAD", headers);
      }
      await enforceShareRateLimit(request, env);
      const response = await service.sharedArtifact(
        decode(sharedArtifact[1] ?? ""),
        resourceId(sharedArtifact[2] ?? ""),
      );
      attachCors(response, headers);
      if (request.method === "HEAD") {
        await response.body?.cancel();
        return new Response(null, { status: response.status, headers: response.headers });
      }
      return response;
    }

    const shared = url.pathname.match(new RegExp(`^${SHARED_ROOT}/${ID}$`));
    if (shared) {
      if (request.method !== "GET") return methodNotAllowed("GET", headers);
      await enforceShareRateLimit(request, env);
      return json(
        sharedReportSchema.parse(await service.sharedReport(decode(shared[1] ?? ""))),
        headers,
      );
    }

    const owner = await resolveAnonymousOwner(request);
    applyCookie(headers, owner.setCookie);

    if (url.pathname === ROOT) {
      if (request.method === "POST") {
        const input = saveInvestigationRequestSchema.parse(await readJson(request));
        return json(await service.save(owner.ownerId, input), headers, 201);
      }
      if (request.method === "GET") {
        return json(
          savedInvestigationListResponseSchema.parse(
            await service.list(owner.ownerId, parseList(url)),
          ),
          headers,
        );
      }
      return methodNotAllowed("GET, POST", headers);
    }

    const ownerArtifact = url.pathname.match(new RegExp(`^${ROOT}/${ID}/artifacts/${ID}$`));
    if (ownerArtifact) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return methodNotAllowed("GET, HEAD", headers);
      }
      const response = await service.ownerArtifact(
        owner.ownerId,
        resourceId(ownerArtifact[1] ?? ""),
        resourceId(ownerArtifact[2] ?? ""),
      );
      attachCors(response, headers, owner.setCookie);
      if (request.method === "HEAD") {
        await response.body?.cancel();
        return new Response(null, { status: response.status, headers: response.headers });
      }
      return response;
    }

    const shareItem = url.pathname.match(new RegExp(`^${ROOT}/${ID}/shares/${ID}$`));
    if (shareItem) {
      if (request.method !== "DELETE") return methodNotAllowed("DELETE", headers);
      await service.revokeShare(
        owner.ownerId,
        resourceId(shareItem[1] ?? ""),
        resourceId(shareItem[2] ?? ""),
      );
      return json({ revoked: true }, headers);
    }

    const shares = url.pathname.match(new RegExp(`^${ROOT}/${ID}/shares$`));
    if (shares) {
      const investigationId = resourceId(shares[1] ?? "");
      if (request.method === "POST") {
        const options = shareOptionsSchema.parse(await readJson(request));
        return json(
          await service.createShare(owner.ownerId, investigationId, options),
          headers,
          201,
        );
      }
      if (request.method === "GET") {
        return json(
          shareListResponseSchema.parse({
            shares: await service.listShares(owner.ownerId, investigationId),
          }),
          headers,
        );
      }
      return methodNotAllowed("GET, POST", headers);
    }

    const detail = url.pathname.match(new RegExp(`^${ROOT}/${ID}$`));
    if (detail) {
      const investigationId = resourceId(detail[1] ?? "");
      if (request.method === "GET") {
        return json(
          savedInvestigationDetailSchema.parse(await service.get(owner.ownerId, investigationId)),
          headers,
        );
      }
      if (request.method === "PATCH") {
        const input = renameSavedInvestigationRequestSchema.parse(await readJson(request));
        return json(
          savedInvestigationDetailSchema.parse(
            await service.rename(owner.ownerId, investigationId, input.title),
          ),
          headers,
        );
      }
      if (request.method === "DELETE") {
        await service.delete(owner.ownerId, investigationId);
        return json({ deleted: true }, headers);
      }
      return methodNotAllowed("GET, PATCH, DELETE", headers);
    }

    return errorResponse(
      { code: "not_found", message: "Persistence resource not found.", retryable: false },
      404,
      headers,
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        {
          code: "invalid_request",
          message: "The persistence request failed runtime validation.",
          retryable: false,
          details: { issues: error.issues.slice(0, 8).map((issue) => issue.path.join(".")) },
        },
        400,
        headers,
      );
    }
    if (error instanceof WorkerError) {
      return errorResponse(error.publicError, error.status, headers);
    }
    throw error;
  }
}
