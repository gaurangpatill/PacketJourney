// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  httpInvestigationResponseSchema,
  investigationErrorResponseSchema,
} from "../features/investigation/httpApi";
import type { AddressResolver, DnsQueryClient, DnsRecordType } from "./security/dns";
import type { BrowserDiagnosticResult, BrowserInvestigator } from "./browser/types";
import { createRouter } from "./router";

const endpoint = "https://api.packetjourney.example/api/v1/investigations/http";

class PublicResolver implements AddressResolver {
  resolve(): Promise<string[]> {
    return Promise.resolve(["93.184.216.34"]);
  }
}

class MissingDnsClient implements DnsQueryClient {
  query(hostname: string, recordType: DnsRecordType) {
    return Promise.resolve({
      hostname,
      recordType,
      response: { Status: 3, AD: false, Answer: [] },
      collectedAt: "2026-07-16T12:00:00.000Z",
      durationMs: 1,
      source: "Fixture resolver",
    });
  }
}

class FixtureBrowserInvestigator implements BrowserInvestigator {
  readonly calls: string[] = [];

  investigate(url: string): Promise<BrowserDiagnosticResult> {
    this.calls.push(url);
    return Promise.resolve({
      status: "success",
      requestedUrl: url,
      finalUrl: url,
      title: "Fixture browser page",
      mainDocumentStatus: 200,
      mainDocumentContentType: "text/html",
      redirectCount: 0,
      readiness: "loaded",
      viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
      navigation: { domContentLoadedMs: 200, loadEventMs: 300, firstContentfulPaintMs: 180 },
      resources: [],
      resourceSummary: {
        totalObserved: 0,
        retained: 0,
        truncated: false,
        firstPartyCount: 0,
        thirdPartyCount: 0,
        failedCount: 0,
        domains: 0,
      },
      console: [],
      consoleTruncated: false,
      blockedRequests: [],
      artifact: {
        id: "123e4567-e89b-42d3-a456-426614174000",
        type: "screenshot",
        label: "Rendered page screenshot",
        storage: "r2",
        contentType: "image/jpeg",
        sizeBytes: 3,
        access: "worker-mediated",
        url: "/api/v1/artifacts/screenshots/123e4567-e89b-42d3-a456-426614174000",
      },
      errors: [],
      limitations: ["Fixture browser session."],
      startedAt: "2026-07-17T12:00:00.000Z",
      completedAt: "2026-07-17T12:00:01.000Z",
      durationMs: 1_000,
    });
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
    expect(
      httpInvestigationResponseSchema
        .parse(payload)
        .investigation.stages.find((stage) => stage.type === "tls"),
    ).toMatchObject({ status: "warning" });
  });

  it("returns browser evidence through the existing canonical endpoint", async () => {
    const browser = new FixtureBrowserInvestigator();
    const router = createRouter({
      resolver: new PublicResolver(),
      targetFetch: vi
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 200, headers: { "content-type": "text/html" } }),
        ),
      browserInvestigator: browser,
      investigationId: () => "browser-api-test",
    });
    const response = await router(investigationRequest("https://example.com"), {
      ENVIRONMENT: "test",
    });
    const payload = httpInvestigationResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(browser.calls).toEqual(["https://example.com/"]);
    expect(payload.investigation.stages).toContainEqual(
      expect.objectContaining({ id: "browser-investigation", type: "browser" }),
    );
    expect(payload.investigation.metrics).toMatchObject({
      browserDurationMs: 1_000,
      firstContentfulPaintMs: 180,
    });
    expect(payload.investigation.artifacts).toEqual([
      expect.objectContaining({ storage: "r2", access: "worker-mediated", sizeBytes: 3 }),
    ]);
    expect(JSON.stringify(payload)).not.toContain("browser-screenshots/");
  });

  it("returns an explicit unavailable stage when browser collection is disabled", async () => {
    const limit = vi.fn();
    const router = createRouter({
      resolver: new PublicResolver(),
      targetFetch: vi
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 200, headers: { "content-type": "text/html" } }),
        ),
    });
    const response = await router(investigationRequest("https://example.com"), {
      ENVIRONMENT: "test",
      BROWSER: { fetch: vi.fn(), connect: vi.fn() },
      BROWSER_ENABLED: "false",
      BROWSER_INVESTIGATION_RATE_LIMITER: { limit },
    });
    const payload = httpInvestigationResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.investigation.stages).toContainEqual(
      expect.objectContaining({
        id: "browser-investigation",
        title: "Browser investigation unavailable",
        status: "warning",
      }),
    );
    expect(payload.investigation.stages.some((stage) => stage.id === "browser-complete")).toBe(
      false,
    );
    expect(limit).not.toHaveBeenCalled();
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

  it("returns a structured DNS failure journey without starting HTTP", async () => {
    const targetFetch = vi.fn();
    const router = createRouter({
      resolver: new PublicResolver(),
      dnsClient: new MissingDnsClient(),
      targetFetch,
      investigationId: () => "live-dns-failure",
    });
    const response = await router(investigationRequest("https://missing.example"), {
      ENVIRONMENT: "test",
    });
    const payload = httpInvestigationResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      investigation: { id: "live-dns-failure", status: "failed" },
      partialError: { code: "upstream_error", stage: "dns", retryable: true },
    });
    expect(payload.investigation.stages.map((stage) => stage.type)).toEqual([
      "input",
      "dns",
      "error",
    ]);
    expect(targetFetch).not.toHaveBeenCalled();
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
      "dns-1",
      "tls-1",
      "redirect-1",
      "dns-2",
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

  it("applies the Cloudflare rate limiter before investigation work", async () => {
    const targetFetch = vi.fn();
    const limit = vi.fn().mockResolvedValue({ success: false });
    const router = createRouter({ resolver: new PublicResolver(), targetFetch });
    const response = await router(investigationRequest("https://example.com"), {
      HTTP_INVESTIGATION_RATE_LIMITER: { limit },
    });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "rate_limited", retryable: true },
    });
    expect(limit).toHaveBeenCalledWith({
      key: "/api/v1/investigations/http:unidentified-client",
    });
    expect(targetFetch).not.toHaveBeenCalled();
  });

  it("applies a stricter browser rate limit before launching expensive work", async () => {
    const browser = new FixtureBrowserInvestigator();
    const targetFetch = vi.fn();
    const limit = vi.fn().mockResolvedValue({ success: false });
    const router = createRouter({
      resolver: new PublicResolver(),
      targetFetch,
      browserInvestigator: browser,
    });
    const response = await router(investigationRequest("https://example.com"), {
      BROWSER_INVESTIGATION_RATE_LIMITER: { limit },
    });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "browser_rate_limited", retryable: true },
    });
    expect(targetFetch).not.toHaveBeenCalled();
    expect(browser.calls).toHaveLength(0);
  });
});
