import {
  createShareResponseSchema,
  persistenceErrorResponseSchema,
  saveInvestigationResponseSchema,
  savedInvestigationDetailSchema,
  savedInvestigationListResponseSchema,
  shareListResponseSchema,
  sharedReportSchema,
  type SaveInvestigationRequest,
  type SaveInvestigationResponse,
  type SavedInvestigationDetail,
  type SavedInvestigationListResponse,
  type ShareOptions,
  type ShareSummary,
  type CreateShareResponse,
  type SharedReport,
} from "./schema";
import { apiBaseUrl, InvestigationApiClientError, type ApiFetch } from "../investigation/api";

async function request<T>(
  path: string,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  init: RequestInit = {},
  fetcher: ApiFetch = fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(`${apiBaseUrl()}${path}`, { ...init, credentials: "include" });
  } catch {
    throw new InvestigationApiClientError(0, {
      code: "network_error",
      message: "The saved-investigation service could not be reached.",
      retryable: true,
    });
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  if (!response.ok) {
    const error = persistenceErrorResponseSchema.safeParse(payload);
    throw new InvestigationApiClientError(
      response.status,
      error.success
        ? error.data.error
        : {
            code: "invalid_response",
            message: "The persistence service returned an unexpected response.",
            retryable: response.status >= 500,
          },
    );
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new InvestigationApiClientError(response.status, {
      code: "invalid_response",
      message: "The persistence response failed runtime validation.",
      retryable: false,
    });
  }
  return parsed.data;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export function saveInvestigation(
  input: SaveInvestigationRequest,
  fetcher?: ApiFetch,
): Promise<SaveInvestigationResponse> {
  return request(
    "/api/v1/saved-investigations",
    saveInvestigationResponseSchema,
    json(input),
    fetcher,
  );
}

export function listSavedInvestigations(
  query = "",
  fetcher?: ApiFetch,
): Promise<SavedInvestigationListResponse> {
  return request(
    `/api/v1/saved-investigations${query ? `?${query}` : ""}`,
    savedInvestigationListResponseSchema,
    {},
    fetcher,
  );
}

export function getSavedInvestigation(
  id: string,
  fetcher?: ApiFetch,
): Promise<SavedInvestigationDetail> {
  return request(
    `/api/v1/saved-investigations/${encodeURIComponent(id)}`,
    savedInvestigationDetailSchema,
    {},
    fetcher,
  );
}

export function renameSavedInvestigation(id: string, title: string, fetcher?: ApiFetch) {
  return request(
    `/api/v1/saved-investigations/${encodeURIComponent(id)}`,
    savedInvestigationDetailSchema,
    { ...json({ title }), method: "PATCH" },
    fetcher,
  );
}

export async function deleteSavedInvestigation(id: string, fetcher?: ApiFetch): Promise<void> {
  await request(
    `/api/v1/saved-investigations/${encodeURIComponent(id)}`,
    {
      safeParse: (value: unknown) =>
        value && typeof value === "object" && (value as Record<string, unknown>).deleted === true
          ? { success: true as const, data: undefined }
          : { success: false as const },
    },
    { method: "DELETE" },
    fetcher,
  );
}

export function createShare(
  id: string,
  options: ShareOptions,
  fetcher?: ApiFetch,
): Promise<CreateShareResponse> {
  return request(
    `/api/v1/saved-investigations/${encodeURIComponent(id)}/shares`,
    createShareResponseSchema,
    json(options),
    fetcher,
  );
}

export function listShares(id: string, fetcher?: ApiFetch): Promise<{ shares: ShareSummary[] }> {
  return request(
    `/api/v1/saved-investigations/${encodeURIComponent(id)}/shares`,
    shareListResponseSchema,
    {},
    fetcher,
  );
}

export async function revokeShare(id: string, shareId: string, fetcher?: ApiFetch): Promise<void> {
  await request(
    `/api/v1/saved-investigations/${encodeURIComponent(id)}/shares/${encodeURIComponent(shareId)}`,
    {
      safeParse: (value: unknown) =>
        value && typeof value === "object" && (value as Record<string, unknown>).revoked === true
          ? { success: true as const, data: undefined }
          : { success: false as const },
    },
    { method: "DELETE" },
    fetcher,
  );
}

export function getSharedReport(token: string, fetcher?: ApiFetch): Promise<SharedReport> {
  return request(
    `/api/v1/shared-reports/${encodeURIComponent(token)}`,
    sharedReportSchema,
    {},
    fetcher,
  );
}
