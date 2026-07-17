export type InvestigationErrorCode =
  | "invalid_request"
  | "invalid_url"
  | "blocked_destination"
  | "method_not_allowed"
  | "rate_limited"
  | "not_found"
  | "timeout"
  | "upstream_error"
  | "internal_error";

export interface PublicError {
  code: InvestigationErrorCode;
  message: string;
  stage?: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export class WorkerError extends Error {
  readonly status: number;
  readonly publicError: PublicError;

  constructor(status: number, publicError: PublicError) {
    super(publicError.message);
    this.name = "WorkerError";
    this.status = status;
    this.publicError = publicError;
  }
}

export function errorResponse(error: PublicError, status: number, headers?: HeadersInit): Response {
  return Response.json({ error }, { status, headers });
}
