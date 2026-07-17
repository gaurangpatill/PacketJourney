import type { NormalizedUrl } from "../security/url";

export type AllowedHeaders = Record<string, string>;

export interface RedirectHop {
  index: number;
  sourceUrl: string;
  status: number;
  statusText: string;
  location?: string;
  destinationUrl?: string;
  destinationValidation: "passed" | "blocked" | "invalid";
  durationMs: number;
  headers: AllowedHeaders;
  headersTruncated: boolean;
  collectedAt: string;
}

export interface FinalHttpResponse {
  url: string;
  status: number;
  statusText: string;
  durationMs: number;
  headers: AllowedHeaders;
  headersTruncated: boolean;
  collectedAt: string;
}

export type DiagnosticErrorCode =
  | "redirect_loop"
  | "missing_redirect_location"
  | "invalid_redirect_destination"
  | "blocked_redirect_destination"
  | "maximum_redirects_exceeded"
  | "request_timeout"
  | "upstream_request_failed"
  | "headers_too_large";

export interface DiagnosticError {
  code: DiagnosticErrorCode;
  message: string;
  stage: "redirect" | "http";
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface HttpDiagnosticResult {
  requestedUrl: string;
  normalizedUrl: NormalizedUrl;
  redirects: RedirectHop[];
  finalResponse?: FinalHttpResponse;
  error?: DiagnosticError;
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
}
