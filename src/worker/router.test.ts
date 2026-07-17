// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { routeRequest } from "./router";

describe("Worker router foundation", () => {
  it("reports a typed health response", async () => {
    const response = await routeRequest(new Request("https://api.example/health"), {
      ENVIRONMENT: "test",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "packet-journey-api",
      environment: "test",
    });
  });

  it("allows only explicitly configured CORS origins", async () => {
    const request = new Request("https://api.example/health", {
      headers: { origin: "https://packetjourney.example" },
    });
    const allowed = await routeRequest(request, {
      CORS_ALLOWED_ORIGINS: "https://packetjourney.example",
    });
    const denied = await routeRequest(request, {
      CORS_ALLOWED_ORIGINS: "https://different.example",
    });

    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "https://packetjourney.example",
    );
    expect(allowed.headers.get("vary")).toBe("Origin");
    expect(denied.headers.has("access-control-allow-origin")).toBe(false);
  });

  it("returns a structured not-found error", async () => {
    const response = await routeRequest(new Request("https://api.example/nope"), {});

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "not_found",
        message: "Route not found.",
        retryable: false,
      },
    });
  });

  it("serves private R2 screenshot artifacts only through the bounded read route", async () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    const bucket = {
      get: vi.fn().mockResolvedValue({
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            controller.close();
          },
        }),
        size: 3,
        httpEtag: '"etag"',
        httpMetadata: { contentType: "image/jpeg" },
        customMetadata: { expiresAt: "2099-01-01T00:00:00.000Z" },
      }),
    } as unknown as R2Bucket;
    const response = await routeRequest(
      new Request("https://api.example/api/v1/artifacts/screenshots/" + id),
      { BROWSER_ARTIFACTS: bucket },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toContain("private");
  });

  it("does not expose artifact writes or arbitrary object keys", async () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    const response = await routeRequest(
      new Request("https://api.example/api/v1/artifacts/screenshots/" + id, { method: "PUT" }),
      {},
    );
    const arbitrary = await routeRequest(
      new Request("https://api.example/api/v1/artifacts/screenshots/../../secret"),
      {},
    );

    expect(response.status).toBe(405);
    expect(arbitrary.status).toBe(404);
  });
});
