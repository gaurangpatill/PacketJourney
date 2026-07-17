// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  httpInvestigationResponseSchema,
  investigationErrorResponseSchema,
} from "../features/investigation/httpApi";
import type { AddressResolver } from "./security/dns";
import { createRouter } from "./router";

const endpoint = "https://api.packetjourney.example/api/v1/investigations/http";

class PublicResolver implements AddressResolver {
  resolve(): Promise<string[]> {
    return Promise.resolve(["93.184.216.34"]);
  }
}

function investigationRequest(url: string, origin?: string): Request {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify({ url }),
  });
}

describe("POST /api/v1/investigations/http", () => {
  it("returns a runtime-validated live investigation", async () => {
    const targetFetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: {
          "cache-control": "public, max-age=300",
          "content-type": "text/html",
          "strict-transport-security": "max-age=31536000",
        },
      }),
    );
    const router = createRouter({
      resolver: new PublicResolver(),
      targetFetch,
      investigationId: () => "live-api-test",
    });
    const response = await router(investigationRequest("example.com"), { ENVIRONMENT: "test" });
    const payload: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(httpInvestigationResponseSchema.safeParse(payload).success).toBe(true);
    expect(payload).toMatchObject({
      investigation: {
        id: "live-api-test",
        normalizedUrl: "https://example.com/",
        scenario: "live-http",
        mock: false,
      },
    });
  });

  it("rejects malformed JSON and invalid request bodies", async () => {
    const router = createRouter({ resolver: new PublicResolver() });
    const malformed = await router(new Request(endpoint, { method: "POST", body: "{" }), {
      ENVIRONMENT: "test",
    });
    const wrongShape = await router(
      new Request(endpoint, { method: "POST", body: JSON.stringify({ target: "example.com" }) }),
      { ENVIRONMENT: "test" },
    );

    expect(malformed.status).toBe(400);
    expect(wrongShape.status).toBe(400);
    expect(investigationErrorResponseSchema.safeParse(await malformed.json()).success).toBe(true);
  });

  it("rejects unsupported schemes with a structured error", async () => {
    const router = createRouter({ resolver: new PublicResolver() });
    const response = await router(investigationRequest("ftp://example.com/file"), {
      ENVIRONMENT: "test",
    });
    const payload = investigationErrorResponseSchema.parse(await response.json());

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      error: { code: "invalid_url", retryable: false, details: { reason: "unsupported_protocol" } },
    });
    expect(JSON.stringify(payload)).not.toContain("stack");
  });

  it("blocks direct private destinations before target fetch", async () => {
    const targetFetch = vi.fn();
    const router = createRouter({ resolver: new PublicResolver(), targetFetch });
    const response = await router(investigationRequest("http://127.0.0.1/admin"), {
      ENVIRONMENT: "test",
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "blocked_destination", retryable: false },
    });
    expect(targetFetch).not.toHaveBeenCalled();
  });

  it("returns a failed partial investigation on target timeout", async () => {
    const targetFetch = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
    const router = createRouter({
      resolver: new PublicResolver(),
      targetFetch,
      investigationId: () => "live-timeout",
    });
    const response = await router(investigationRequest("https://example.com"), {
      ENVIRONMENT: "test",
    });
    const payload = httpInvestigationResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      investigation: { id: "live-timeout", status: "failed" },
      partialError: { code: "timeout", stage: "http", retryable: true },
    });
  });

  it("preserves a public redirect before blocking its private destination", async () => {
    const targetFetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" },
      }),
    );
    const router = createRouter({
      resolver: new PublicResolver(),
      targetFetch,
      investigationId: () => "live-blocked-redirect",
    });
    const response = await router(investigationRequest("https://example.com"), {
      ENVIRONMENT: "test",
    });
    const payload = httpInvestigationResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      investigation: { status: "failed" },
      partialError: { code: "blocked_destination", stage: "redirect", retryable: false },
    });
    expect(payload.investigation.stages.map((stage) => stage.id)).toEqual([
      "input",
      "redirect-1",
      "terminal-error",
    ]);
  });

  it("handles CORS preflight and limits allowed origins", async () => {
    const router = createRouter({ resolver: new PublicResolver() });
    const allowedOrigin = "https://packetjourney.example";
    const response = await router(
      new Request(endpoint, { method: "OPTIONS", headers: { origin: allowedOrigin } }),
      { CORS_ALLOWED_ORIGINS: allowedOrigin },
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(allowedOrigin);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("returns 405 for unsafe methods", async () => {
    const router = createRouter({ resolver: new PublicResolver() });
    const response = await router(new Request(endpoint, { method: "PUT" }), {});

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST, OPTIONS");
  });
});
