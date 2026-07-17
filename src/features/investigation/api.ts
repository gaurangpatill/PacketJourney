import {
  httpInvestigationResponseSchema,
  investigationErrorResponseSchema,
  type HttpInvestigationResponse,
  type InvestigationApiError,
} from "./httpApi";

const HTTP_INVESTIGATION_PATH = "/api/v1/investigations/http";

export type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class InvestigationApiClientError extends Error {
  readonly status: number;
  readonly details: InvestigationApiError;

  constructor(status: number, details: InvestigationApiError) {
    super(details.message);
    this.name = "InvestigationApiClientError";
    this.status = status;
    this.details = details;
  }
}

function endpointUrl(): string {
  const baseUrl = apiBaseUrl();
  return `${baseUrl}${HTTP_INVESTIGATION_PATH}`;
}

export function apiBaseUrl(): string {
  return (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
}

export function artifactUrl(path: string): string {
  return `${apiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

function genericError(status: number): InvestigationApiError {
  return {
    code: "invalid_response",
    message: "The investigation service returned an unexpected response.",
    retryable: status >= 500,
  };
}

export async function createHttpInvestigation(
  url: string,
  options: { signal?: AbortSignal; fetcher?: ApiFetch } = {},
): Promise<HttpInvestigationResponse> {
  const fetcher = options.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(endpointUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
      signal: options.signal,
    });
  } catch (error) {
    const aborted =
      options.signal?.aborted ||
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && error.name === "AbortError");
    throw new InvestigationApiClientError(0, {
      code: aborted ? "client_timeout" : "network_error",
      message: aborted
        ? "The live investigation did not finish before the client timeout."
        : "The browser could not reach the Packet Journey Worker.",
      retryable: true,
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new InvestigationApiClientError(response.status, genericError(response.status));
  }

  if (!response.ok) {
    const parsedError = investigationErrorResponseSchema.safeParse(payload);
    throw new InvestigationApiClientError(
      response.status,
      parsedError.success ? parsedError.data.error : genericError(response.status),
    );
  }

  const parsed = httpInvestigationResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new InvestigationApiClientError(response.status, genericError(response.status));
  }
  return parsed.data;
}
