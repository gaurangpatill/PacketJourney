// @vitest-environment node
import type {
  Browser,
  BrowserContext,
  Page,
  Request as PlaywrightRequest,
  Response as PlaywrightResponse,
  Route,
} from "@cloudflare/playwright";
import { describe, expect, it, vi } from "vitest";
import type { BrowserArtifactStore } from "../artifacts/r2";
import type { AddressResolver } from "../security/dns";
import { CloudflareBrowserInvestigator, UnavailableBrowserInvestigator } from "./client";

class PublicResolver implements AddressResolver {
  resolve(): Promise<string[]> {
    return Promise.resolve(["93.184.216.34"]);
  }
}

const artifactStore: BrowserArtifactStore = {
  storeScreenshot: vi.fn().mockResolvedValue({
    id: "123e4567-e89b-42d3-a456-426614174000",
    type: "screenshot",
    label: "Rendered page screenshot",
    storage: "r2",
    contentType: "image/jpeg",
    access: "worker-mediated",
    url: "/api/v1/artifacts/screenshots/123e4567-e89b-42d3-a456-426614174000",
  }),
};

function request(url: string, navigation = false): PlaywrightRequest {
  return {
    url: () => url,
    method: () => "GET",
    resourceType: () => (navigation ? "document" : "script"),
    isNavigationRequest: () => navigation,
    redirectedFrom: () => null,
  } as unknown as PlaywrightRequest;
}

function fixtureBrowser(
  options: {
    navigationError?: Error;
    blockedNavigationUrl?: string;
    pageCreationError?: Error;
  } = {},
) {
  const pageClose = vi.fn().mockResolvedValue(undefined);
  const screenshot = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
  const contextClose = vi.fn().mockResolvedValue(undefined);
  const browserClose = vi.fn().mockResolvedValue(undefined);
  let routeHandler: ((route: Route) => Promise<void>) | undefined;
  const mainRequest = request("https://example.com/", true);
  const response = {
    status: () => 200,
    headers: () => ({ "content-type": "text/html" }),
    request: () => mainRequest,
  } as unknown as PlaywrightResponse;
  const page = {
    on: vi.fn(),
    goto: vi.fn().mockImplementation(async () => {
      if (options.blockedNavigationUrl && routeHandler) {
        const abort = vi.fn().mockResolvedValue(undefined);
        await routeHandler({
          request: () => request(options.blockedNavigationUrl ?? "", true),
          abort,
          continue: vi.fn(),
        } as unknown as Route);
        throw new Error("net::ERR_BLOCKED_BY_CLIENT");
      }
      if (options.navigationError) throw options.navigationError;
      return response;
    }),
    url: () => "https://example.com/",
    title: vi.fn().mockResolvedValue("Example"),
    evaluate: vi.fn().mockResolvedValue({
      navigation: {
        responseStart: 100,
        domContentLoadedEventEnd: 350,
        loadEventEnd: 500,
      },
      paints: [
        { name: "first-paint", startTime: 180 },
        { name: "first-contentful-paint", startTime: 200 },
      ],
      largestContentfulPaint: 450,
      resources: [],
      renderBlockingUrls: [],
      readyState: "complete",
    }),
    screenshot,
    close: pageClose,
  } as unknown as Page;
  const context = {
    addInitScript: vi.fn().mockResolvedValue(undefined),
    newPage: options.pageCreationError
      ? vi.fn().mockRejectedValue(options.pageCreationError)
      : vi.fn().mockResolvedValue(page),
    route: vi.fn().mockImplementation((_pattern, handler) => {
      routeHandler = handler as (route: Route) => Promise<void>;
      return Promise.resolve();
    }),
    close: contextClose,
  } as unknown as BrowserContext;
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    close: browserClose,
  } as unknown as Browser;
  return { browser, page, screenshot, pageClose, contextClose, browserClose };
}

function investigator(browser: Browser) {
  return new CloudflareBrowserInvestigator(
    { fetch: vi.fn() },
    new PublicResolver(),
    artifactStore,
    vi.fn().mockResolvedValue(browser),
  );
}

describe("Cloudflare browser lifecycle", () => {
  it("collects navigation metrics and closes page, context, and browser", async () => {
    const fixture = fixtureBrowser();
    const result = await investigator(fixture.browser).investigate("https://example.com/");

    expect(result).toMatchObject({
      status: "success",
      finalUrl: "https://example.com/",
      title: "Example",
      mainDocumentStatus: 200,
      readiness: "loaded",
      navigation: {
        timeToFirstByteMs: 100,
        domContentLoadedMs: 350,
        firstContentfulPaintMs: 200,
      },
      artifact: { storage: "r2" },
    });
    expect(fixture.pageClose).toHaveBeenCalledOnce();
    expect(fixture.contextClose).toHaveBeenCalledOnce();
    expect(fixture.browserClose).toHaveBeenCalledOnce();
  });

  it("preserves partial evidence and cleanup on navigation timeout", async () => {
    const fixture = fixtureBrowser({ navigationError: new Error("Timeout 20000ms exceeded") });
    const result = await investigator(fixture.browser).investigate("https://example.com/");

    expect(result.status).toBe("partial");
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "browser_navigation_timeout", phase: "navigation" }),
    );
    expect(fixture.pageClose).toHaveBeenCalledOnce();
    expect(fixture.contextClose).toHaveBeenCalledOnce();
    expect(fixture.browserClose).toHaveBeenCalledOnce();
  });

  it("blocks a private top-level redirect and records the policy failure", async () => {
    const fixture = fixtureBrowser({ blockedNavigationUrl: "http://127.0.0.1/admin" });
    const result = await investigator(fixture.browser).investigate("https://example.com/");

    expect(result.status).toBe("partial");
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "browser_navigation_blocked", retryable: false }),
    );
    expect(result.blockedRequests).toContainEqual(
      expect.objectContaining({ hostname: "127.0.0.1", failed: true }),
    );
    expect(fixture.screenshot).not.toHaveBeenCalled();
  });

  it("closes the browser when page creation fails", async () => {
    const fixture = fixtureBrowser({ pageCreationError: new Error("page failed") });
    const result = await investigator(fixture.browser).investigate("https://example.com/");

    expect(result.status).toBe("error");
    expect(result.errors[0]?.code).toBe("browser_page_failed");
    expect(fixture.contextClose).toHaveBeenCalledOnce();
    expect(fixture.browserClose).toHaveBeenCalledOnce();
  });

  it("returns a structured launch error without attempting page cleanup", async () => {
    const launch = vi.fn().mockRejectedValue(new Error("launch failed"));
    const result = await new CloudflareBrowserInvestigator(
      { fetch: vi.fn() },
      new PublicResolver(),
      artifactStore,
      launch,
    ).investigate("https://example.com/");

    expect(result).toMatchObject({
      status: "error",
      errors: [{ code: "browser_launch_failed", phase: "launch" }],
    });
  });

  it("returns an explicit unavailable result when the Browser Run binding is missing", async () => {
    await expect(
      new UnavailableBrowserInvestigator().investigate("https://example.com/"),
    ).resolves.toMatchObject({
      status: "unavailable",
      readiness: "unavailable",
      errors: [{ code: "browser_binding_unavailable", retryable: false }],
    });
  });

  it("enforces the overall deadline even when launch does not settle", async () => {
    const ticks = [0, 30_000, 30_001];
    const result = await new CloudflareBrowserInvestigator(
      { fetch: vi.fn() },
      new PublicResolver(),
      artifactStore,
      () => new Promise<Browser>(() => undefined),
      () => ticks.shift() ?? 30_001,
    ).investigate("https://example.com/");

    expect(result).toMatchObject({
      status: "error",
      errors: [{ code: "browser_launch_failed", retryable: true }],
    });
  });
});
