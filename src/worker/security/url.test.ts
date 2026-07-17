// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizeInvestigationUrl, resolveRedirectUrl, UrlPolicyError } from "./url";

describe("normalizeInvestigationUrl", () => {
  it("adds HTTPS and normalizes hostname casing", () => {
    expect(normalizeInvestigationUrl("Example.COM/path?q=1#fragment")).toMatchObject({
      canonicalUrl: "https://example.com/path?q=1",
      hostname: "example.com",
      protocol: "https:",
    });
  });

  it("preserves meaningful paths, queries, and valid ports", () => {
    expect(normalizeInvestigationUrl("http://example.com:8080/a%20b?x=y").canonicalUrl).toBe(
      "http://example.com:8080/a%20b?x=y",
    );
  });

  it.each([
    ["https://user:secret@example.com", "credentials_not_allowed"],
    ["ftp://example.com/file", "unsupported_protocol"],
    ["https://example.com:", "invalid_port"],
    ["https://example.com:0", "invalid_port"],
    ["https://bad_host.example", "invalid_hostname"],
    ["http://example.com:99999", "invalid_url"],
  ] as const)("rejects %s", (input, code) => {
    expect(() => normalizeInvestigationUrl(input)).toThrowError(
      expect.objectContaining<Partial<UrlPolicyError>>({ code }),
    );
  });

  it("rejects excessively long input", () => {
    expect(() =>
      normalizeInvestigationUrl(`https://example.com/${"a".repeat(2_100)}`),
    ).toThrowError(expect.objectContaining<Partial<UrlPolicyError>>({ code: "url_too_long" }));
  });

  it("resolves relative redirect locations and strips fragments", () => {
    expect(resolveRedirectUrl("../final#section", "https://example.com/a/start").canonicalUrl).toBe(
      "https://example.com/final",
    );
  });
});
