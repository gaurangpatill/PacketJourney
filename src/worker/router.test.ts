// @vitest-environment node
import { describe, expect, it } from "vitest";
import { routeRequest } from "./router";

describe("Worker router foundation", () => {
  it("reports a typed health response", async () => {
    const response = routeRequest(new Request("https://api.example/health"), {
      ENVIRONMENT: "test",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "packet-journey-api",
      environment: "test",
    });
  });

  it("allows only explicitly configured CORS origins", () => {
    const request = new Request("https://api.example/health", {
      headers: { origin: "https://packetjourney.example" },
    });
    const allowed = routeRequest(request, {
      CORS_ALLOWED_ORIGINS: "https://packetjourney.example",
    });
    const denied = routeRequest(request, {
      CORS_ALLOWED_ORIGINS: "https://different.example",
    });

    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "https://packetjourney.example",
    );
    expect(allowed.headers.get("vary")).toBe("Origin");
    expect(denied.headers.has("access-control-allow-origin")).toBe(false);
  });

  it("returns a structured not-found error", async () => {
    const response = routeRequest(new Request("https://api.example/nope"), {});

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "not_found",
        message: "Route not found.",
        retryable: false,
      },
    });
  });
});
