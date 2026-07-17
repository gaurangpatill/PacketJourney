// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { investigations } from "../../data/investigations";
import { createHttpInvestigation } from "./api";

const recorded = investigations[0]!;
const liveInvestigation = {
  ...recorded,
  id: "live-client-test",
  title: "Live client test",
  scenario: "live-http" as const,
  mock: false,
};

describe("HTTP investigation API client", () => {
  it("posts the URL and validates the response contract", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ investigation: liveInvestigation }));

    await expect(
      createHttpInvestigation("https://example.com/", { fetcher }),
    ).resolves.toMatchObject({ investigation: { id: "live-client-test", mock: false } });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/investigations/http",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/" }),
      }),
    );
  });

  it("surfaces structured Worker errors", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "blocked_destination",
            message: "Private destinations are blocked.",
            retryable: false,
          },
        },
        { status: 403 },
      ),
    );

    await expect(createHttpInvestigation("http://127.0.0.1", { fetcher })).rejects.toMatchObject({
      status: 403,
      details: { code: "blocked_destination", retryable: false },
    });
  });

  it("rejects malformed success payloads rather than inventing fallback data", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ result: "unknown" }));

    await expect(createHttpInvestigation("https://example.com", { fetcher })).rejects.toMatchObject(
      {
        details: { code: "invalid_response" },
      },
    );
  });

  it("classifies aborted requests as retryable client timeouts", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));

    await expect(
      createHttpInvestigation("https://example.com", {
        fetcher,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({
      details: { code: "client_timeout", retryable: true },
    });
  });
});
