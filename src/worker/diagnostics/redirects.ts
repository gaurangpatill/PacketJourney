import type { RuntimeLimits } from "../env";
import type { AddressResolver } from "../security/dns";
import { SsrfPolicyError, validatePublicDestination } from "../security/ssrf";
import {
  normalizeInvestigationUrl,
  resolveRedirectUrl,
  type NormalizedUrl,
  UrlPolicyError,
} from "../security/url";
import { collectAllowedHeaders } from "./headers";
import type {
  DiagnosticError,
  FinalHttpResponse,
  HttpDiagnosticResult,
  RedirectHop,
} from "./types";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
export const MAX_REDIRECTS = 8;

const SAFE_REQUEST_HEADERS = {
  accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
  "accept-encoding": "gzip, br",
  "user-agent": "PacketJourney/0.3 (+https://github.com/gaurangpatill/PacketJourney)",
} as const;

export type DiagnosticFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface RedirectTraceDependencies {
  fetcher?: DiagnosticFetch;
  resolver: AddressResolver;
  monotonicNow?: () => number;
  wallClockNow?: () => Date;
}

function roundedDuration(start: number, end: number): number {
  return Math.max(0, Math.round((end - start) * 100) / 100);
}

function completedResult(
  base: Omit<HttpDiagnosticResult, "completedAt" | "totalDurationMs">,
  startedTick: number,
  monotonicNow: () => number,
  wallClockNow: () => Date,
): HttpDiagnosticResult {
  return {
    ...base,
    completedAt: wallClockNow().toISOString(),
    totalDurationMs: roundedDuration(startedTick, monotonicNow()),
  };
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The evidence is already captured. A consumed or closed body needs no further handling.
  }
}

async function validateWithTimeout(
  destination: NormalizedUrl,
  resolver: AddressResolver,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await validatePublicDestination(destination, resolver, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchHop(
  url: string,
  fetcher: DiagnosticFetch,
  timeoutMs: number,
): Promise<{ response?: Response; durationMs: number; error?: DiagnosticError }> {
  const controller = new AbortController();
  const started = performance.now();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(url, {
      method: "GET",
      headers: SAFE_REQUEST_HEADERS,
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    });
    return { response, durationMs: roundedDuration(started, performance.now()) };
  } catch (error) {
    const timedOut =
      controller.signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && error.name === "AbortError");
    return {
      durationMs: roundedDuration(started, performance.now()),
      error: timedOut
        ? {
            code: "request_timeout",
            message: "The remote server did not respond before the request timeout.",
            stage: "http",
            retryable: true,
          }
        : {
            code: "upstream_request_failed",
            message: "The remote server could not be reached from the investigation Worker.",
            stage: "http",
            retryable: true,
          },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function traceHttpRedirects(
  input: string,
  limits: Pick<RuntimeLimits, "hopTimeoutMs" | "overallTimeoutMs">,
  dependencies: RedirectTraceDependencies,
): Promise<HttpDiagnosticResult> {
  const fetcher = dependencies.fetcher ?? fetch;
  const monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
  const wallClockNow = dependencies.wallClockNow ?? (() => new Date());
  const startedTick = monotonicNow();
  const startedAt = wallClockNow().toISOString();
  const normalizedUrl = normalizeInvestigationUrl(input);
  let current = await validateWithTimeout(
    normalizedUrl,
    dependencies.resolver,
    limits.hopTimeoutMs,
  );
  const redirects: RedirectHop[] = [];
  const visited = new Set([current.canonicalUrl]);

  const finish = (fields: {
    finalResponse?: FinalHttpResponse;
    error?: DiagnosticError;
  }): HttpDiagnosticResult =>
    completedResult(
      {
        requestedUrl: input,
        normalizedUrl,
        redirects,
        ...fields,
        startedAt,
      },
      startedTick,
      monotonicNow,
      wallClockNow,
    );

  while (true) {
    const elapsed = monotonicNow() - startedTick;
    const remaining = limits.overallTimeoutMs - elapsed;
    if (remaining <= 0) {
      return finish({
        error: {
          code: "request_timeout",
          message: "The investigation exceeded its overall time limit.",
          stage: "http",
          retryable: true,
        },
      });
    }

    const result = await fetchHop(
      current.canonicalUrl,
      fetcher,
      Math.min(limits.hopTimeoutMs, remaining),
    );
    if (!result.response) return finish({ error: result.error });

    const response = result.response;
    const collectedAt = wallClockNow().toISOString();
    const collected = collectAllowedHeaders(response.headers);

    if (!REDIRECT_STATUSES.has(response.status)) {
      const finalResponse: FinalHttpResponse = {
        url: current.canonicalUrl,
        status: response.status,
        statusText: response.statusText,
        durationMs: result.durationMs,
        headers: collected.values,
        headersTruncated: collected.truncated,
        collectedAt,
      };
      await cancelBody(response);
      return finish({ finalResponse });
    }

    const location = response.headers.get("location") ?? undefined;
    const baseHop: Omit<RedirectHop, "destinationValidation"> = {
      index: redirects.length,
      sourceUrl: current.canonicalUrl,
      status: response.status,
      statusText: response.statusText,
      location,
      durationMs: result.durationMs,
      headers: collected.values,
      headersTruncated: collected.truncated,
      collectedAt,
    };
    await cancelBody(response);

    if (!location) {
      redirects.push({ ...baseHop, destinationValidation: "invalid" });
      return finish({
        error: {
          code: "missing_redirect_location",
          message: `HTTP ${response.status} did not include a Location header.`,
          stage: "redirect",
          retryable: false,
        },
      });
    }

    let destination;
    try {
      destination = resolveRedirectUrl(location, current.canonicalUrl);
    } catch (error) {
      redirects.push({ ...baseHop, destinationValidation: "invalid" });
      return finish({
        error: {
          code: "invalid_redirect_destination",
          message:
            error instanceof UrlPolicyError
              ? error.message
              : "The redirect destination is not a valid public URL.",
          stage: "redirect",
          retryable: false,
        },
      });
    }

    try {
      const validationRemaining = Math.max(
        1,
        limits.overallTimeoutMs - (monotonicNow() - startedTick),
      );
      current = await validateWithTimeout(
        destination,
        dependencies.resolver,
        Math.min(limits.hopTimeoutMs, validationRemaining),
      );
    } catch (error) {
      redirects.push({
        ...baseHop,
        destinationUrl: destination.canonicalUrl,
        destinationValidation: "blocked",
      });
      return finish({
        error: {
          code: "blocked_redirect_destination",
          message:
            error instanceof SsrfPolicyError
              ? error.message
              : "The redirect destination did not pass the public-network safety policy.",
          stage: "redirect",
          retryable: error instanceof SsrfPolicyError && error.retryable,
          details: error instanceof SsrfPolicyError ? error.details : undefined,
        },
      });
    }

    redirects.push({
      ...baseHop,
      destinationUrl: current.canonicalUrl,
      destinationValidation: "passed",
    });

    if (visited.has(current.canonicalUrl)) {
      return finish({
        error: {
          code: "redirect_loop",
          message: "The website redirected to a URL already visited in this investigation.",
          stage: "redirect",
          retryable: false,
          details: { destination: current.canonicalUrl },
        },
      });
    }
    if (redirects.length > MAX_REDIRECTS) {
      return finish({
        error: {
          code: "maximum_redirects_exceeded",
          message: `The website exceeded the ${MAX_REDIRECTS}-redirect safety limit.`,
          stage: "redirect",
          retryable: false,
        },
      });
    }

    visited.add(current.canonicalUrl);
  }
}
