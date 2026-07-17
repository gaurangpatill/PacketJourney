import { z } from "zod";
import { investigationSchema } from "./schema";

export const createHttpInvestigationRequestSchema = z.object({
  url: z.string().min(1).max(2_048),
});

export const investigationApiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  stage: z.string().min(1).optional(),
  retryable: z.boolean(),
  details: z.record(z.unknown()).optional(),
});

export const httpInvestigationResponseSchema = z.object({
  investigation: investigationSchema,
  partialError: investigationApiErrorSchema.optional(),
});

export const investigationErrorResponseSchema = z.object({
  error: investigationApiErrorSchema,
});

export type CreateHttpInvestigationRequest = z.infer<typeof createHttpInvestigationRequestSchema>;
export type HttpInvestigationResponse = z.infer<typeof httpInvestigationResponseSchema>;
export type InvestigationApiError = z.infer<typeof investigationApiErrorSchema>;
export type InvestigationErrorResponse = z.infer<typeof investigationErrorResponseSchema>;
