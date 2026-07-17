import { describe, expect, it } from "vitest";
import { createRouter } from "../router";

const route = createRouter();
const env = { ENVIRONMENT: "test" as const };

describe("persistence API routing", () => {
  it("returns a structured unavailable response when D1 is not bound", async () => {
    const response = await route(
      new Request("https://worker.test/api/v1/saved-investigations"),
      env,
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "persistence_unavailable", retryable: false },
    });
  });

  it("rejects unsupported methods without leaking internals", async () => {
    const response = await route(
      new Request("https://worker.test/api/v1/shared-reports/bad", { method: "POST" }),
      env,
    );
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toMatch(/stack|D1Database/i);
  });

  it("handles CORS preflight for persistence mutations", async () => {
    const response = await route(
      new Request("https://worker.test/api/v1/saved-investigations", {
        method: "OPTIONS",
        headers: { origin: "https://app.test" },
      }),
      { ...env, CORS_ALLOWED_ORIGINS: "https://app.test" },
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("DELETE");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });
});
