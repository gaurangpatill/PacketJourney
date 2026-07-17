// @vitest-environment node
import { describe, expect, it } from "vitest";
import { analyzeSecurityHeaders } from "./securityHeaders";

function statusOf(
  headers: Record<string, string>,
  id: string,
  protocol: "http:" | "https:" = "https:",
) {
  return analyzeSecurityHeaders(headers, protocol).find((item) => item.id === id)?.status;
}

describe("security header analysis", () => {
  const strongHeaders = {
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=()",
    "cross-origin-opener-policy": "same-origin",
  };

  it("recognizes a strong observed header set", () => {
    expect(
      analyzeSecurityHeaders(strongHeaders, "https:").every((item) => item.status === "present"),
    ).toBe(true);
  });

  it("checks HSTS only for HTTPS final responses", () => {
    expect(statusOf({}, "hsts", "https:")).toBe("missing");
    expect(statusOf({}, "hsts", "http:")).toBe("not-applicable");
  });

  it("does not claim CSP quality from mere presence", () => {
    const csp = analyzeSecurityHeaders(
      { "content-security-policy": "default-src *" },
      "https:",
    ).find((item) => item.id === "csp");
    expect(csp).toMatchObject({ status: "present" });
    expect(csp?.explanation).toContain("does not establish policy quality");
  });

  it("accepts frame protection through CSP frame-ancestors", () => {
    expect(
      statusOf({ "content-security-policy": "frame-ancestors 'none'" }, "frame-protection"),
    ).toBe("present");
  });

  it("accepts frame protection through X-Frame-Options", () => {
    expect(statusOf({ "x-frame-options": "DENY" }, "frame-protection")).toBe("present");
  });

  it("treats missing policies as contextual hardening opportunities", () => {
    const checks = analyzeSecurityHeaders({}, "https:");
    expect(checks.filter((item) => item.status === "missing")).toHaveLength(7);
    expect(checks.find((item) => item.id === "hsts")?.explanation).toContain(
      "not proof of a vulnerability",
    );
  });
});
