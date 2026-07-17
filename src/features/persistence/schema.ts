import { z } from "zod";
import { counterfactualResultSchema } from "../counterfactual/schemas";
import { aiDiagnosisSchema, aiExpertiseModeSchema } from "../investigation/aiSchema";
import { investigationSchema } from "../investigation/schema";
import { investigationApiErrorSchema } from "../investigation/httpApi";

export const PERSISTED_INVESTIGATION_SCHEMA_VERSION = 1 as const;

export const selectedDiagnosisSchema = z
  .object({
    diagnosis: aiDiagnosisSchema,
    expertiseMode: aiExpertiseModeSchema,
  })
  .strict();

export const saveInvestigationRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    investigation: investigationSchema,
    selectedDiagnosis: selectedDiagnosisSchema.optional(),
    selectedCounterfactual: counterfactualResultSchema.optional(),
    preserveScreenshot: z.boolean().default(true),
  })
  .strict();

export const findingCountsSchema = z
  .object({
    high: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
    info: z.number().int().nonnegative(),
  })
  .strict();

export const savedInvestigationSummarySchema = z
  .object({
    id: z.string().uuid(),
    sourceInvestigationId: z.string().min(1).max(160),
    title: z.string().min(1).max(120),
    requestedUrl: z.string().url(),
    finalUrl: z.string().url().optional(),
    hostname: z.string().min(1).max(253),
    status: z.enum(["completed", "failed"]),
    sourceType: z.enum(["live", "recorded"]),
    schemaVersion: z.literal(PERSISTED_INVESTIGATION_SCHEMA_VERSION),
    investigationHash: z.string().regex(/^[0-9a-f]{64}$/),
    findingCounts: findingCountsSchema,
    hasAiDiagnosis: z.boolean(),
    hasCounterfactual: z.boolean(),
    hasScreenshot: z.boolean(),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
    savedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const savedArtifactSchema = z
  .object({
    id: z.string().uuid(),
    type: z.literal("screenshot"),
    contentType: z.enum(["image/webp", "image/jpeg", "image/png"]),
    sizeBytes: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    url: z.string().min(1),
  })
  .strict();

export const savedInvestigationDetailSchema = z
  .object({
    summary: savedInvestigationSummarySchema,
    investigation: investigationSchema,
    selectedDiagnosis: selectedDiagnosisSchema.optional(),
    selectedCounterfactual: counterfactualResultSchema.optional(),
    artifacts: z.array(savedArtifactSchema).max(8),
    label: z.literal("SAVED INVESTIGATION"),
    freshnessNotice: z.string().min(1).max(300),
  })
  .strict();

export const saveInvestigationResponseSchema = z
  .object({
    saved: savedInvestigationDetailSchema,
    duplicate: z.boolean(),
    warnings: z.array(z.string().min(1).max(300)).max(8),
  })
  .strict();

export const savedInvestigationListResponseSchema = z
  .object({
    items: z.array(savedInvestigationSummarySchema).max(50),
    nextCursor: z.string().max(500).optional(),
  })
  .strict();

export const renameSavedInvestigationRequestSchema = z
  .object({ title: z.string().trim().min(1).max(120) })
  .strict();

export const shareOptionsSchema = z
  .object({
    expiresAt: z.string().datetime().optional(),
    includeAiDiagnosis: z.boolean(),
    includeCounterfactual: z.boolean(),
    includeScreenshot: z.boolean(),
  })
  .strict();

export const shareSummarySchema = z
  .object({
    id: z.string().uuid(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime().optional(),
    revokedAt: z.string().datetime().optional(),
    lastAccessedAt: z.string().datetime().optional(),
    accessCount: z.number().int().nonnegative(),
    options: shareOptionsSchema.omit({ expiresAt: true }),
  })
  .strict();

export const createShareResponseSchema = z
  .object({
    share: shareSummarySchema,
    token: z.string().min(40).max(100),
    path: z.string().min(1).max(200),
  })
  .strict();

export const shareListResponseSchema = z
  .object({ shares: z.array(shareSummarySchema).max(10) })
  .strict();

export const sharedReportSchema = z
  .object({
    label: z.literal("SAVED SNAPSHOT"),
    access: z.literal("READ ONLY"),
    capturedAt: z.string().datetime(),
    freshnessNotice: z.string().min(1).max(300),
    title: z.string().min(1).max(120),
    requestedUrl: z.string().url(),
    finalUrl: z.string().url().optional(),
    status: z.enum(["completed", "failed"]),
    sourceType: z.enum(["live", "recorded"]),
    investigation: investigationSchema,
    selectedDiagnosis: selectedDiagnosisSchema.optional(),
    selectedCounterfactual: counterfactualResultSchema.optional(),
    artifacts: z.array(savedArtifactSchema).max(8),
    runtimeLimitations: z.array(z.string().min(1).max(500)).max(20),
  })
  .strict();

export const persistenceErrorResponseSchema = z
  .object({ error: investigationApiErrorSchema })
  .strict();

export type SaveInvestigationRequest = z.infer<typeof saveInvestigationRequestSchema>;
export type SelectedDiagnosis = z.infer<typeof selectedDiagnosisSchema>;
export type SavedInvestigationSummary = z.infer<typeof savedInvestigationSummarySchema>;
export type SavedArtifact = z.infer<typeof savedArtifactSchema>;
export type SavedInvestigationDetail = z.infer<typeof savedInvestigationDetailSchema>;
export type SaveInvestigationResponse = z.infer<typeof saveInvestigationResponseSchema>;
export type SavedInvestigationListResponse = z.infer<typeof savedInvestigationListResponseSchema>;
export type ShareOptions = z.infer<typeof shareOptionsSchema>;
export type ShareSummary = z.infer<typeof shareSummarySchema>;
export type CreateShareResponse = z.infer<typeof createShareResponseSchema>;
export type SharedReport = z.infer<typeof sharedReportSchema>;
