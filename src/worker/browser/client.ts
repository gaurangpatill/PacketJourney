import type { Browser, BrowserContext, BrowserWorker, Page, Request } from "@cloudflare/playwright";
import type { BrowserArtifactStore } from "../artifacts/r2";
import { ArtifactStorageError } from "../artifacts/r2";
import { logEvent } from "../logging";
import type { AddressResolver } from "../security/dns";
import { classifyParty, classifyThirdParty, normalizeResourceType } from "./classification";
import { BROWSER_LIMITS, BROWSER_VIEWPORT } from "./limits";
import { selectBrowserResources, summarizeBrowserResources } from "./resources";
import { sanitizeConsoleMessage, sanitizeObservedUrl } from "./sanitize";
import { validateBrowserRequest } from "./safety";
import type {
  BrowserConsoleEntry,
  BrowserDiagnosticError,
  BrowserDiagnosticResult,
  BrowserInvestigator,
  BrowserResource,
  BrowserResourceSummary,
} from "./types";

type LaunchBrowser = (binding: BrowserWorker) => Promise<Browser>;

interface MutableResource {
  request: Request;
  url: string;
  hostname: string;
  origin: string;
  type: BrowserResource["type"];
  method: string;
  status?: number;
  contentType?: string;
  failed: boolean;
  failureReason?: string;
  initiator?: string;
}

interface PerformanceSnapshot {
  navigation?: {
    responseStart?: number;
    domContentLoadedEventEnd?: number;
    loadEventEnd?: number;
  };
  paints: Array<{ name: string; startTime: number }>;
  largestContentfulPaint?: number;
  resources: Array<{
    name: string;
    initiatorType: string;
    startTime: number;
    duration: number;
    transferSize: number;
    encodedBodySize: number;
    decodedBodySize: number;
    nextHopProtocol: string;
  }>;
  renderBlockingUrls: string[];
  readyState: string;
}

function nowIso(now: () => Date): string {
  return now().toISOString();
}

function duration(started: number, current: number): number {
  return Math.max(0, Math.round((current - started) * 100) / 100);
}

async function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), Math.max(1, timeoutMs));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function finiteMetric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value * 100) / 100
    : undefined;
}

function redirectCount(request: Request | undefined): number {
  let count = 0;
  let current = request?.redirectedFrom() ?? null;
  while (current && count <= 20) {
    count += 1;
    current = current.redirectedFrom();
  }
  return count;
}

function emptySummary(): BrowserResourceSummary {
  return {
    totalObserved: 0,
    retained: 0,
    truncated: false,
    firstPartyCount: 0,
    thirdPartyCount: 0,
    failedCount: 0,
    domains: 0,
  };
}

function errorResult(
  url: string,
  startedAt: string,
  completedAt: string,
  durationMs: number,
  error: BrowserDiagnosticError,
): BrowserDiagnosticResult {
  return {
    status: error.code === "browser_binding_unavailable" ? "unavailable" : "error",
    requestedUrl: url,
    redirectCount: 0,
    readiness: "unavailable",
    viewport: BROWSER_VIEWPORT,
    navigation: {},
    resources: [],
    resourceSummary: emptySummary(),
    console: [],
    consoleTruncated: false,
    blockedRequests: [],
    errors: [error],
    limitations: [
      "Browser metrics are one isolated lab session and are not real-user monitoring data.",
    ],
    startedAt,
    completedAt,
    durationMs,
  };
}

async function collectPerformance(page: Page): Promise<PerformanceSnapshot> {
  return page.evaluate(() => {
    type BrowserPerformanceEntry = {
      name: string;
      startTime: number;
      duration: number;
      initiatorType?: string;
      transferSize?: number;
      encodedBodySize?: number;
      decodedBodySize?: number;
      nextHopProtocol?: string;
      responseStart?: number;
      domContentLoadedEventEnd?: number;
      loadEventEnd?: number;
    };
    const browserPerformance = performance as unknown as {
      getEntriesByType(type: string): BrowserPerformanceEntry[];
    };
    const browserDocument = (
      globalThis as unknown as {
        document: {
          readyState: string;
          querySelectorAll(selector: string): ArrayLike<{ href?: string; src?: string }>;
        };
      }
    ).document;
    const navigation = browserPerformance.getEntriesByType("navigation")[0];
    const paints = browserPerformance.getEntriesByType("paint").map((entry) => ({
      name: entry.name,
      startTime: entry.startTime,
    }));
    const resources = browserPerformance.getEntriesByType("resource").map((resource) => ({
      name: resource.name,
      initiatorType: resource.initiatorType ?? "other",
      startTime: resource.startTime,
      duration: resource.duration,
      transferSize: resource.transferSize ?? 0,
      encodedBodySize: resource.encodedBodySize ?? 0,
      decodedBodySize: resource.decodedBodySize ?? 0,
      nextHopProtocol: resource.nextHopProtocol ?? "",
    }));
    const renderBlockingUrls = [
      ...Array.from(browserDocument.querySelectorAll('link[rel="stylesheet"][href]')).flatMap(
        (element) => (element.href ? [element.href] : []),
      ),
      ...Array.from(
        browserDocument.querySelectorAll("script[src]:not([async]):not([defer])"),
      ).flatMap((element) => (element.src ? [element.src] : [])),
    ];
    return {
      navigation: navigation
        ? {
            responseStart: navigation.responseStart,
            domContentLoadedEventEnd: navigation.domContentLoadedEventEnd,
            loadEventEnd: navigation.loadEventEnd,
          }
        : undefined,
      paints,
      largestContentfulPaint: (globalThis as typeof globalThis & { __packetJourneyLcp?: number })
        .__packetJourneyLcp,
      resources,
      renderBlockingUrls,
      readyState: browserDocument.readyState,
    };
  });
}

export class UnavailableBrowserInvestigator implements BrowserInvestigator {
  constructor(private readonly message = "The Cloudflare Browser Run binding is unavailable.") {}

  investigate(url: string): Promise<BrowserDiagnosticResult> {
    const timestamp = new Date().toISOString();
    return Promise.resolve(
      errorResult(url, timestamp, timestamp, 0, {
        code: "browser_binding_unavailable",
        message: this.message,
        retryable: false,
        phase: "binding",
      }),
    );
  }
}

export class CloudflareBrowserInvestigator implements BrowserInvestigator {
  constructor(
    private readonly binding: BrowserWorker,
    private readonly resolver: AddressResolver,
    private readonly artifacts: BrowserArtifactStore,
    private readonly launchBrowser?: LaunchBrowser,
    private readonly monotonicNow: () => number = () => performance.now(),
    private readonly wallClockNow: () => Date = () => new Date(),
  ) {}

  async investigate(url: string): Promise<BrowserDiagnosticResult> {
    const startedTick = this.monotonicNow();
    const startedAt = nowIso(this.wallClockNow);
    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    let page: Page | undefined;
    const errors: BrowserDiagnosticError[] = [];
    const consoleEntries: BrowserConsoleEntry[] = [];
    let consoleObserved = 0;
    const rawResources = new Map<Request, MutableResource>();
    let resourcesObserved = 0;
    const blockedRequests: BrowserResource[] = [];
    const validatedHosts = new Map<string, Promise<unknown>>();
    let navigationViolation: string | undefined;
    let readiness: BrowserDiagnosticResult["readiness"] = "partial";
    let mainResponse: Awaited<ReturnType<Page["goto"]>> | undefined;
    const remainingMs = () =>
      Math.max(1, BROWSER_LIMITS.investigationTimeoutMs - (this.monotonicNow() - startedTick));

    const validateRequestUrl = async (requestUrl: string, navigationRequest: boolean) => {
      const parsed = new URL(requestUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return validateBrowserRequest(requestUrl, navigationRequest, this.resolver);
      }
      const key = `${parsed.protocol}//${parsed.hostname}:${parsed.port}`;
      const existing = validatedHosts.get(key);
      if (existing) return existing;
      const pending = validateBrowserRequest(requestUrl, navigationRequest, this.resolver);
      validatedHosts.set(key, pending);
      try {
        await pending;
      } catch (error) {
        validatedHosts.delete(key);
        throw error;
      }
    };

    try {
      logEvent("info", "browser.launch.started");
      try {
        const launchBrowser =
          this.launchBrowser ??
          (async (binding: BrowserWorker) => {
            const playwright = await import("@cloudflare/playwright");
            return playwright.launch(binding);
          });
        browser = await withDeadline(
          launchBrowser(this.binding),
          remainingMs(),
          "Browser investigation deadline exceeded during launch.",
        );
      } catch {
        return errorResult(
          url,
          startedAt,
          nowIso(this.wallClockNow),
          duration(startedTick, this.monotonicNow()),
          {
            code: "browser_launch_failed",
            message: "Cloudflare Browser Run could not launch an isolated browser session.",
            retryable: true,
            phase: "launch",
          },
        );
      }
      logEvent("info", "browser.launch.completed");
      context = await withDeadline(
        browser.newContext({
          viewport: { width: BROWSER_VIEWPORT.width, height: BROWSER_VIEWPORT.height },
          deviceScaleFactor: BROWSER_VIEWPORT.deviceScaleFactor,
          userAgent: "PacketJourney/0.1 (+https://github.com/gaurangpatill/PacketJourney)",
          javaScriptEnabled: true,
          acceptDownloads: false,
          serviceWorkers: "block",
        }),
        remainingMs(),
        "Browser investigation deadline exceeded while creating a context.",
      );
      await context.addInitScript({
        content:
          "globalThis.__packetJourneyLcp=undefined;new PerformanceObserver((list)=>{const last=list.getEntries().at(-1);if(last)globalThis.__packetJourneyLcp=last.startTime}).observe({type:'largest-contentful-paint',buffered:true});",
      });
      try {
        page = await withDeadline(
          context.newPage(),
          remainingMs(),
          "Browser investigation deadline exceeded while creating a page.",
        );
      } catch {
        errors.push({
          code: "browser_page_failed",
          message: "The browser session could not create an isolated page.",
          retryable: true,
          phase: "launch",
        });
        throw new Error("page-creation-failed");
      }

      await context.route("**/*", async (route) => {
        const request = route.request();
        const requestUrl = request.url();
        try {
          if (
            request.isNavigationRequest() &&
            redirectCount(request) > BROWSER_LIMITS.maximumRedirects
          ) {
            throw new Error("Browser redirect limit exceeded.");
          }
          await validateRequestUrl(requestUrl, request.isNavigationRequest());
          await route.continue();
        } catch {
          const type = normalizeResourceType(request.resourceType());
          let hostname = "unavailable";
          let origin = "unavailable";
          try {
            const parsed = new URL(requestUrl);
            hostname = parsed.hostname || "unavailable";
            origin = parsed.origin;
          } catch {
            // Preserve a bounded unavailable classification.
          }
          blockedRequests.push({
            id: `blocked-${blockedRequests.length + 1}`,
            url: sanitizeObservedUrl(requestUrl),
            origin,
            hostname,
            type,
            method: request.method(),
            firstParty: false,
            classificationBasis: "Blocked before the browser network request completed.",
            failed: true,
            failureReason: "Blocked by Packet Journey public-network browser policy.",
            renderBlockingCandidate: false,
          });
          if (request.isNavigationRequest()) navigationViolation = requestUrl;
          await route.abort("blockedbyclient");
        }
      });

      page.on("request", (request) => {
        resourcesObserved += 1;
        if (rawResources.size >= BROWSER_LIMITS.maximumObservedResources) return;
        try {
          const parsed = new URL(request.url());
          rawResources.set(request, {
            request,
            url: sanitizeObservedUrl(request.url()),
            hostname: parsed.hostname.toLowerCase(),
            origin: parsed.origin,
            type: normalizeResourceType(request.resourceType()),
            method: request.method().slice(0, 16),
            failed: false,
            initiator: request.resourceType().slice(0, 32),
          });
        } catch {
          // Non-network browser URLs are not retained as resource evidence.
        }
      });
      page.on("response", (response) => {
        const resource = rawResources.get(response.request());
        if (!resource) return;
        resource.status = response.status();
        const headers = response.headers();
        resource.contentType = headers["content-type"]?.slice(0, 128);
      });
      page.on("requestfailed", (request) => {
        const resource = rawResources.get(request);
        if (!resource) return;
        resource.failed = true;
        resource.failureReason = request.failure()?.errorText.slice(0, 256) ?? "Request failed";
      });
      page.on("console", (message) => {
        const level = message.type();
        if (level !== "error" && level !== "warning") return;
        consoleObserved += 1;
        if (consoleEntries.length >= BROWSER_LIMITS.maximumConsoleEntries) return;
        const sanitized = sanitizeConsoleMessage(message.text());
        const location = message.location();
        consoleEntries.push({
          level,
          message: sanitized.message,
          ...(location.url ? { sourceUrl: sanitizeObservedUrl(location.url) } : {}),
          ...(location.lineNumber === undefined ? {} : { line: location.lineNumber }),
          ...(location.columnNumber === undefined ? {} : { column: location.columnNumber }),
          timestamp: nowIso(this.wallClockNow),
          origin: "page-console",
          truncated: sanitized.truncated,
        });
      });
      page.on("pageerror", (exception) => {
        consoleObserved += 1;
        if (consoleEntries.length >= BROWSER_LIMITS.maximumConsoleEntries) return;
        const sanitized = sanitizeConsoleMessage(exception.message);
        consoleEntries.push({
          level: "error",
          message: sanitized.message,
          timestamp: nowIso(this.wallClockNow),
          origin: "page-error",
          truncated: sanitized.truncated,
        });
      });

      logEvent("info", "browser.navigation.started");
      try {
        mainResponse = await withDeadline(
          page.goto(url, {
            waitUntil: "load",
            timeout: Math.min(BROWSER_LIMITS.navigationTimeoutMs, remainingMs()),
          }),
          remainingMs(),
          "Browser investigation deadline exceeded during navigation.",
        );
        readiness = "loaded";
      } catch (error) {
        const timedOut = error instanceof Error && /timeout/i.test(error.message);
        errors.push({
          code: navigationViolation
            ? "browser_navigation_blocked"
            : timedOut
              ? "browser_navigation_timeout"
              : "browser_navigation_failed",
          message: navigationViolation
            ? "The browser navigation attempted to enter a prohibited destination."
            : timedOut
              ? "The browser navigation exceeded its bounded load deadline."
              : "The browser could not complete navigation to the verified public page.",
          retryable: !navigationViolation,
          phase: "navigation",
        });
      }
      logEvent("info", "browser.navigation.completed", { readiness });

      let snapshot: PerformanceSnapshot = {
        paints: [],
        resources: [],
        renderBlockingUrls: [],
        readyState: "unavailable",
      };
      let title: string | undefined;
      let finalUrl: string | undefined;
      try {
        finalUrl = sanitizeObservedUrl(page.url());
        title = (
          await withDeadline(
            page.title(),
            remainingMs(),
            "Browser investigation deadline exceeded during title collection.",
          )
        ).slice(0, 256);
        snapshot = await withDeadline(
          collectPerformance(page),
          remainingMs(),
          "Browser investigation deadline exceeded during performance collection.",
        );
        if (readiness !== "loaded" && snapshot.readyState === "interactive") {
          readiness = "dom-content-loaded";
        }
      } catch {
        errors.push({
          code: "browser_collection_failed",
          message: "Some browser performance and document evidence could not be collected.",
          retryable: true,
          phase: "collection",
        });
      }

      const documentHostname = (() => {
        try {
          return new URL(finalUrl ?? url).hostname;
        } catch {
          return new URL(url).hostname;
        }
      })();
      const performanceByUrl = new Map(
        snapshot.resources.map((resource) => [sanitizeObservedUrl(resource.name), resource]),
      );
      const renderBlocking = new Set(snapshot.renderBlockingUrls.map(sanitizeObservedUrl));
      const domContentLoadedMs = finiteMetric(snapshot.navigation?.domContentLoadedEventEnd);
      const loadEventMs = finiteMetric(snapshot.navigation?.loadEventEnd);
      const normalizedResources = [...rawResources.values()].map((resource, index) => {
        const timing = performanceByUrl.get(resource.url);
        const party = classifyParty(resource.hostname, documentHostname);
        const startTimeMs = finiteMetric(timing?.startTime);
        return {
          id: `browser-resource-${index + 1}`,
          url: resource.url,
          origin: resource.origin,
          hostname: resource.hostname,
          type: resource.type,
          method: resource.method,
          ...(resource.status === undefined ? {} : { status: resource.status }),
          ...(resource.contentType ? { contentType: resource.contentType } : {}),
          ...(finiteMetric(timing?.transferSize) === undefined
            ? {}
            : { transferSize: finiteMetric(timing?.transferSize) }),
          ...(finiteMetric(timing?.encodedBodySize) === undefined
            ? {}
            : { encodedBodySize: finiteMetric(timing?.encodedBodySize) }),
          ...(finiteMetric(timing?.decodedBodySize) === undefined
            ? {}
            : { decodedBodySize: finiteMetric(timing?.decodedBodySize) }),
          ...(startTimeMs === undefined ? {} : { startTimeMs }),
          ...(finiteMetric(timing?.duration) === undefined
            ? {}
            : { durationMs: finiteMetric(timing?.duration) }),
          ...(timing?.nextHopProtocol ? { protocol: timing.nextHopProtocol.slice(0, 32) } : {}),
          firstParty: party.firstParty,
          classificationBasis: party.basis,
          ...(party.firstParty
            ? {}
            : { thirdPartyCategory: classifyThirdParty(resource.hostname, resource.type) }),
          failed: resource.failed,
          ...(resource.failureReason ? { failureReason: resource.failureReason } : {}),
          ...(startTimeMs === undefined || domContentLoadedMs === undefined
            ? {}
            : { beforeDomContentLoaded: startTimeMs <= domContentLoadedMs }),
          ...(startTimeMs === undefined || loadEventMs === undefined
            ? {}
            : { beforeLoad: startTimeMs <= loadEventMs }),
          renderBlockingCandidate: renderBlocking.has(resource.url),
          ...(resource.initiator ? { initiator: resource.initiator } : {}),
        } satisfies BrowserResource;
      });
      const selectedResources = selectBrowserResources(normalizedResources);
      const capturedAt = nowIso(this.wallClockNow);
      let artifact;
      try {
        logEvent("info", "browser.screenshot.started");
        if (navigationViolation) {
          throw new Error("A prohibited navigation cannot produce a trusted screenshot.");
        }
        const screenshot = await withDeadline(
          page.screenshot({
            type: "jpeg",
            quality: 72,
            fullPage: false,
            animations: "disabled",
            caret: "hide",
          }),
          remainingMs(),
          "Browser investigation deadline exceeded during screenshot capture.",
        );
        if (screenshot.byteLength > BROWSER_LIMITS.maximumScreenshotBytes) {
          throw new ArtifactStorageError(
            "The screenshot exceeded the artifact size limit.",
            "size_limit",
          );
        }
        artifact = await withDeadline(
          this.artifacts.storeScreenshot({
            bytes: new Uint8Array(screenshot),
            contentType: "image/jpeg",
            capturedAt,
            finalUrl: finalUrl ?? url,
            readiness,
          }),
          remainingMs(),
          "Browser investigation deadline exceeded during artifact storage.",
        );
        logEvent("info", "browser.screenshot.completed", { sizeBytes: screenshot.byteLength });
      } catch (error) {
        const storage = error instanceof ArtifactStorageError;
        errors.push({
          code: storage
            ? error.code === "binding_unavailable"
              ? "browser_artifact_unavailable"
              : "browser_artifact_failed"
            : "browser_screenshot_failed",
          message: storage ? error.message : "The rendered-page screenshot could not be captured.",
          retryable: storage ? error.code !== "size_limit" : true,
          phase: storage ? "artifact" : "screenshot",
        });
      }

      const paints = new Map(snapshot.paints.map((paint) => [paint.name, paint.startTime]));
      const completedAt = nowIso(this.wallClockNow);
      const result: BrowserDiagnosticResult = {
        status: errors.length === 0 ? "success" : "partial",
        requestedUrl: url,
        ...(finalUrl ? { finalUrl } : {}),
        ...(title ? { title } : {}),
        ...(mainResponse ? { mainDocumentStatus: mainResponse.status() } : {}),
        ...(mainResponse?.headers()["content-type"]
          ? { mainDocumentContentType: mainResponse.headers()["content-type"]?.slice(0, 128) }
          : {}),
        redirectCount: redirectCount(mainResponse?.request()),
        readiness,
        viewport: BROWSER_VIEWPORT,
        navigation: {
          ...(finiteMetric(snapshot.navigation?.responseStart) === undefined
            ? {}
            : { timeToFirstByteMs: finiteMetric(snapshot.navigation?.responseStart) }),
          ...(domContentLoadedMs === undefined ? {} : { domContentLoadedMs }),
          ...(loadEventMs === undefined ? {} : { loadEventMs }),
          ...(finiteMetric(paints.get("first-paint")) === undefined
            ? {}
            : { firstPaintMs: finiteMetric(paints.get("first-paint")) }),
          ...(finiteMetric(paints.get("first-contentful-paint")) === undefined
            ? {}
            : { firstContentfulPaintMs: finiteMetric(paints.get("first-contentful-paint")) }),
          ...(finiteMetric(snapshot.largestContentfulPaint) === undefined
            ? {}
            : { largestContentfulPaintMs: finiteMetric(snapshot.largestContentfulPaint) }),
        },
        resources: selectedResources,
        resourceSummary: summarizeBrowserResources(
          normalizedResources,
          resourcesObserved,
          selectedResources.length,
        ),
        console: consoleEntries,
        consoleTruncated: consoleObserved > consoleEntries.length,
        blockedRequests: blockedRequests.slice(0, BROWSER_LIMITS.maximumFailedRequests),
        ...(artifact ? { artifact } : {}),
        errors,
        limitations: [
          "This is one isolated lab browser session, not real-user monitoring or a field performance score.",
          "Resource Timing may omit transfer sizes for cross-origin resources and cached responses.",
          "Browser DNS checks cannot pin Chromium connections to the resolver answers, so a DNS rebinding time-of-check/time-of-use gap remains.",
        ],
        startedAt,
        completedAt,
        durationMs: duration(startedTick, this.monotonicNow()),
      };
      return result;
    } catch {
      const completedAt = nowIso(this.wallClockNow);
      return {
        ...errorResult(
          url,
          startedAt,
          completedAt,
          duration(startedTick, this.monotonicNow()),
          errors[0] ?? {
            code: "browser_collection_failed",
            message: "The browser investigation stopped before collection completed.",
            retryable: true,
            phase: "collection",
          },
        ),
        errors:
          errors.length > 0
            ? errors
            : [
                {
                  code: "browser_collection_failed",
                  message: "The browser investigation stopped before collection completed.",
                  retryable: true,
                  phase: "collection",
                },
              ],
      };
    } finally {
      if (page) {
        try {
          await withDeadline(page.close(), 2_000, "Browser page close deadline exceeded.");
        } catch {
          logEvent("warn", "browser.page.close_failed");
        }
      }
      if (context) {
        try {
          await withDeadline(context.close(), 2_000, "Browser context close deadline exceeded.");
        } catch {
          logEvent("warn", "browser.context.close_failed");
        }
      }
      if (browser) {
        try {
          await withDeadline(browser.close(), 2_000, "Browser close deadline exceeded.");
          logEvent("info", "browser.close.completed");
        } catch {
          logEvent("warn", "browser.close.failed");
        }
      }
    }
  }
}
