// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { AddressResolver } from "../security/dns";
import { MAX_REDIRECTS, traceHttpRedirects } from "./redirects";

const limits = { hopTimeoutMs: 1_000, overallTimeoutMs: 10_000 };

class PublicResolver implements AddressResolver {
  resolve(): Promise<string[]> {
    return Promise.resolve(["93.184.216.34"]);
  }
}

function sequenceFetch(...responses: Response[]) {
  return vi.fn().mockImplementation(() => {
    const response = responses.shift();
    if (!response) return Promise.reject(new Error("Unexpected fetch"));
    return Promise.resolve(response);
  });
}

describe("manual redirect tracing", () => {
  it("captures a direct final response without following automatically", async () => {
    const fetcher = sequenceFetch(
      new Response(null, {
        status: 200,
        headers: { "cache-control": "public, max-age=60", "set-cookie": "private" },
      }),
    );
    const result = await traceHttpRedirects("example.com", limits, {
      fetcher,
      resolver: new PublicResolver(),
    });

    expect(result.redirects).toHaveLength(0);
    expect(result.finalResponse).toMatchObject({
      url: "https://example.com/",
      status: 200,
      headers: { "cache-control": "public, max-age=60" },
    });
    const requestInit = fetcher.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(requestInit).toMatchObject({
      method: "GET",
      redirect: "manual",
      cache: "no-store",
    });
    expect(requestInit?.headers).not.toHaveProperty("cookie");
  });

  it("captures multiple redirects and a relative Location", async () => {
    const fetcher = sequenceFetch(
      new Response(null, { status: 301, headers: { location: "/middle" } }),
      new Response(null, { status: 308, headers: { location: "../final" } }),
      new Response(null, { status: 204 }),
    );
    const result = await traceHttpRedirects("https://example.com/start", limits, {
      fetcher,
      resolver: new PublicResolver(),
    });

    expect(result.redirects.map((hop) => [hop.status, hop.destinationUrl])).toEqual([
      [301, "https://example.com/middle"],
      [308, "https://example.com/final"],
    ]);
    expect(result.finalResponse?.url).toBe("https://example.com/final");
  });

  it("preserves a redirect with a missing Location as a terminal error", async () => {
    const result = await traceHttpRedirects("https://example.com", limits, {
      fetcher: sequenceFetch(new Response(null, { status: 302 })),
      resolver: new PublicResolver(),
    });

    expect(result.redirects).toHaveLength(1);
    expect(result.error?.code).toBe("missing_redirect_location");
    expect(result.finalResponse).toBeUndefined();
  });

  it("rejects unsupported redirect protocols without another target fetch", async () => {
    const fetcher = sequenceFetch(
      new Response(null, { status: 302, headers: { location: "file:///etc/passwd" } }),
    );
    const result = await traceHttpRedirects("https://example.com", limits, {
      fetcher,
      resolver: new PublicResolver(),
    });

    expect(result.error?.code).toBe("invalid_redirect_destination");
    expect(result.redirects[0]?.destinationValidation).toBe("invalid");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("blocks redirects to private destinations and preserves the safe hop", async () => {
    const fetcher = sequenceFetch(
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } }),
    );
    const result = await traceHttpRedirects("https://example.com", limits, {
      fetcher,
      resolver: new PublicResolver(),
    });

    expect(result.error?.code).toBe("blocked_redirect_destination");
    expect(result.redirects[0]).toMatchObject({
      sourceUrl: "https://example.com/",
      destinationUrl: "http://169.254.169.254/latest",
      destinationValidation: "blocked",
    });
  });

  it("detects redirect loops", async () => {
    const fetcher = sequenceFetch(
      new Response(null, { status: 302, headers: { location: "/two" } }),
      new Response(null, { status: 301, headers: { location: "/" } }),
    );
    const result = await traceHttpRedirects("https://example.com", limits, {
      fetcher,
      resolver: new PublicResolver(),
    });

    expect(result.error?.code).toBe("redirect_loop");
    expect(result.redirects).toHaveLength(2);
  });

  it("enforces the bounded redirect count", async () => {
    const responses = Array.from(
      { length: MAX_REDIRECTS + 1 },
      (_, index) => new Response(null, { status: 302, headers: { location: `/hop-${index + 1}` } }),
    );
    const result = await traceHttpRedirects("https://example.com", limits, {
      fetcher: sequenceFetch(...responses),
      resolver: new PublicResolver(),
    });

    expect(result.error?.code).toBe("maximum_redirects_exceeded");
    expect(result.redirects).toHaveLength(MAX_REDIRECTS + 1);
  });

  it("returns a structured timeout without discarding earlier redirects", async () => {
    const fetcher = sequenceFetch(
      new Response(null, { status: 302, headers: { location: "/slow" } }),
    );
    fetcher.mockImplementationOnce(() =>
      Promise.resolve(new Response(null, { status: 302, headers: { location: "/slow" } })),
    );
    fetcher.mockImplementationOnce(() => Promise.reject(new DOMException("aborted", "AbortError")));

    const result = await traceHttpRedirects("https://example.com", limits, {
      fetcher,
      resolver: new PublicResolver(),
    });

    expect(result.redirects).toHaveLength(1);
    expect(result.error).toMatchObject({ code: "request_timeout", retryable: true });
  });
});
