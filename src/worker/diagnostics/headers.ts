import type { AllowedHeaders } from "./types";

export const RESPONSE_HEADER_ALLOWLIST = [
  "location",
  "cache-control",
  "age",
  "expires",
  "etag",
  "last-modified",
  "vary",
  "content-type",
  "content-length",
  "content-encoding",
  "server",
  "via",
  "cf-cache-status",
  "cf-ray",
  "strict-transport-security",
  "content-security-policy",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "permissions-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
] as const;

const MAX_SINGLE_HEADER_LENGTH = 4_096;
const MAX_COLLECTED_HEADER_LENGTH = 32_768;

export interface CollectedHeaders {
  values: AllowedHeaders;
  truncated: boolean;
}

export function collectAllowedHeaders(headers: Headers): CollectedHeaders {
  const values: AllowedHeaders = {};
  let collectedLength = 0;
  let truncated = false;

  for (const name of RESPONSE_HEADER_ALLOWLIST) {
    const rawValue = headers.get(name);
    if (rawValue === null) continue;

    const remaining = MAX_COLLECTED_HEADER_LENGTH - collectedLength;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const maximum = Math.min(MAX_SINGLE_HEADER_LENGTH, remaining);
    const value = rawValue.slice(0, maximum);
    if (value.length < rawValue.length) truncated = true;
    values[name] = value;
    collectedLength += name.length + value.length;
  }

  return { values, truncated };
}
