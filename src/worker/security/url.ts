const MAX_URL_LENGTH = 2_048;
const SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i;
const HOST_LABEL_PATTERN = /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i;

export type UrlPolicyCode =
  | "empty_url"
  | "url_too_long"
  | "unsupported_protocol"
  | "credentials_not_allowed"
  | "invalid_url"
  | "invalid_hostname"
  | "invalid_port";

export class UrlPolicyError extends Error {
  readonly code: UrlPolicyCode;

  constructor(code: UrlPolicyCode, message: string) {
    super(message);
    this.name = "UrlPolicyError";
    this.code = code;
  }
}

export interface NormalizedUrl {
  canonicalUrl: string;
  displayUrl: string;
  hostname: string;
  protocol: "http:" | "https:";
}

function hasMalformedEmptyPort(candidate: string): boolean {
  const authority = candidate.match(/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i)?.[1];
  if (!authority) return false;
  const withoutCredentials = authority.slice(authority.lastIndexOf("@") + 1);
  return withoutCredentials.endsWith(":");
}

function normalizeHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function isDnsHostname(hostname: string): boolean {
  if (hostname.length > 253) return false;
  return hostname.split(".").every((label) => HOST_LABEL_PATTERN.test(label));
}

function looksLikeIpLiteral(hostname: string): boolean {
  return hostname.includes(":") || /^\d+(?:\.\d+){0,3}$/.test(hostname);
}

export function normalizeInvestigationUrl(input: string): NormalizedUrl {
  const trimmed = input.trim();
  if (!trimmed) throw new UrlPolicyError("empty_url", "Enter a public HTTP or HTTPS URL.");
  if (trimmed.length > MAX_URL_LENGTH) {
    throw new UrlPolicyError("url_too_long", `URLs must be ${MAX_URL_LENGTH} characters or fewer.`);
  }

  const candidate = SCHEME_PATTERN.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (hasMalformedEmptyPort(candidate)) {
    throw new UrlPolicyError("invalid_port", "The URL contains a malformed port.");
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new UrlPolicyError("invalid_url", "Enter a valid public website URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UrlPolicyError(
      "unsupported_protocol",
      "Only HTTP and HTTPS destinations can be investigated.",
    );
  }
  if (parsed.username || parsed.password) {
    throw new UrlPolicyError(
      "credentials_not_allowed",
      "Credentials embedded in URLs are not allowed.",
    );
  }
  if (parsed.port === "0") {
    throw new UrlPolicyError("invalid_port", "The URL port must be between 1 and 65535.");
  }

  const hostname = normalizeHostname(parsed.hostname.toLowerCase().replace(/\.$/, ""));
  if (!hostname || (!looksLikeIpLiteral(hostname) && !isDnsHostname(hostname))) {
    throw new UrlPolicyError("invalid_hostname", "Enter a valid public hostname.");
  }

  if (parsed.hostname.endsWith(".")) parsed.hostname = parsed.hostname.slice(0, -1);
  parsed.hash = "";
  const canonicalUrl = parsed.toString();

  return {
    canonicalUrl,
    displayUrl: canonicalUrl,
    hostname,
    protocol: parsed.protocol,
  };
}

export function resolveRedirectUrl(location: string, sourceUrl: string): NormalizedUrl {
  let destination: URL;
  try {
    destination = new URL(location, sourceUrl);
  } catch {
    throw new UrlPolicyError("invalid_url", "The redirect destination is not a valid URL.");
  }
  return normalizeInvestigationUrl(destination.toString());
}
