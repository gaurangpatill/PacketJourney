import type { AllowedHeaders } from "./types";

export type SecurityCheckStatus = "present" | "missing" | "not-applicable";
export type SecurityCheckId =
  | "hsts"
  | "csp"
  | "content-type-options"
  | "frame-protection"
  | "referrer-policy"
  | "permissions-policy"
  | "cross-origin-opener-policy";

export interface SecurityHeaderCheck {
  id: SecurityCheckId;
  label: string;
  status: SecurityCheckStatus;
  sourceHeaders: string[];
  explanation: string;
}

function check(
  id: SecurityCheckId,
  label: string,
  present: boolean,
  sourceHeaders: string[],
  presentText: string,
  missingText: string,
): SecurityHeaderCheck {
  return {
    id,
    label,
    status: present ? "present" : "missing",
    sourceHeaders,
    explanation: present ? presentText : missingText,
  };
}

export function analyzeSecurityHeaders(
  headers: AllowedHeaders,
  protocol: "http:" | "https:",
): SecurityHeaderCheck[] {
  const csp = headers["content-security-policy"];
  const frameProtected =
    Boolean(csp?.toLowerCase().includes("frame-ancestors")) || Boolean(headers["x-frame-options"]);

  const hsts: SecurityHeaderCheck =
    protocol === "https:"
      ? check(
          "hsts",
          "HTTP Strict Transport Security",
          Boolean(headers["strict-transport-security"]),
          ["strict-transport-security"],
          "HSTS was observed on this HTTPS response.",
          "No HSTS header was observed on this HTTPS response; this is a hardening opportunity, not proof of a vulnerability.",
        )
      : {
          id: "hsts",
          label: "HTTP Strict Transport Security",
          status: "not-applicable",
          sourceHeaders: [],
          explanation: "HSTS is assessed on the final HTTPS response, not this HTTP response.",
        };

  return [
    hsts,
    check(
      "csp",
      "Content Security Policy",
      Boolean(csp),
      ["content-security-policy"],
      "A Content Security Policy was observed; presence alone does not establish policy quality.",
      "No Content Security Policy was observed; consider whether a policy fits this application.",
    ),
    check(
      "content-type-options",
      "MIME sniffing protection",
      headers["x-content-type-options"]?.toLowerCase() === "nosniff",
      ["x-content-type-options"],
      "X-Content-Type-Options is set to nosniff.",
      "X-Content-Type-Options: nosniff was not observed.",
    ),
    check(
      "frame-protection",
      "Frame embedding protection",
      frameProtected,
      ["content-security-policy", "x-frame-options"],
      "Frame protection was observed through CSP frame-ancestors or X-Frame-Options.",
      "Neither CSP frame-ancestors nor X-Frame-Options was observed.",
    ),
    check(
      "referrer-policy",
      "Referrer Policy",
      Boolean(headers["referrer-policy"]),
      ["referrer-policy"],
      "A Referrer-Policy header was observed.",
      "No explicit Referrer-Policy header was observed.",
    ),
    check(
      "permissions-policy",
      "Permissions Policy",
      Boolean(headers["permissions-policy"]),
      ["permissions-policy"],
      "A Permissions-Policy header was observed.",
      "No Permissions-Policy header was observed; relevance depends on browser features used.",
    ),
    check(
      "cross-origin-opener-policy",
      "Cross-Origin Opener Policy",
      Boolean(headers["cross-origin-opener-policy"]),
      ["cross-origin-opener-policy"],
      "A Cross-Origin-Opener-Policy header was observed.",
      "No Cross-Origin-Opener-Policy header was observed; cross-origin isolation may not be required.",
    ),
  ];
}
