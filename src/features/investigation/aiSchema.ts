import { z } from "zod";
import { investigationApiErrorSchema } from "./httpApi";
import { investigationSchema } from "./schema";

export const aiExpertiseModeSchema = z.enum(["beginner", "developer", "network-engineer"]);
export const aiConclusionTypeSchema = z.enum([
  "supported",
  "likely",
  "inconclusive",
  "unsupported",
]);
export const aiCategorySchema = z.enum([
  "dns",
  "tls",
  "redirect",
  "cache",
  "origin",
  "frontend",
  "security",
  "third-party",
  "browser",
]);

const boundedText = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .transform((value) =>
      [...value]
        .map((character) => {
          const code = character.charCodeAt(0);
          return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127
            ? " "
            : character;
        })
        .join(""),
    );
const boundedIds = z.array(z.string().min(1).max(160)).max(16);

export const aiFindingSchema = z
  .object({
    title: boundedText(180),
    explanation: boundedText(1_200),
    category: aiCategorySchema,
    severity: z.enum(["info", "low", "medium", "high"]),
    confidence: z.number().min(0).max(1),
    evidenceIds: boundedIds.min(1),
    deterministicFindingIds: boundedIds.optional(),
  })
  .strict();

export const aiActionSchema = z
  .object({
    priority: z.number().int().min(1).max(8),
    title: boundedText(180),
    rationale: boundedText(900),
    evidenceIds: boundedIds.min(1),
    expectedImpact: z.enum(["unknown", "low", "medium", "high"]),
  })
  .strict();

export const aiEvidenceReferenceSchema = z
  .object({
    evidenceId: z.string().min(1).max(160),
    stageId: z.string().min(1).max(160),
    claim: boundedText(500),
  })
  .strict();

export const aiCounterfactualReferenceSchema = z
  .object({
    type: z.enum(["change", "assumption"]),
    id: z.string().min(1).max(200),
    claim: boundedText(500),
  })
  .strict();

export const counterfactualAiContextSchema = z
  .object({
    label: z.literal("SIMULATED · NOT MEASURED"),
    scenarioId: z.string().min(1).max(160),
    ruleId: z.string().min(1).max(160),
    engineVersion: z.string().min(1).max(40),
    changes: z
      .array(
        z
          .object({
            id: z.string().min(1).max(200),
            targetId: z.string().min(1).max(240),
            operation: z.enum(["added", "removed", "modified", "unchanged", "unavailable"]),
            reason: boundedText(500),
            sourceEvidenceIds: boundedIds,
          })
          .strict(),
      )
      .max(24),
    assumptions: z
      .array(
        z
          .object({
            id: z.string().min(1).max(200),
            statement: boundedText(500),
            importance: z.enum(["low", "medium", "high"]),
          })
          .strict(),
      )
      .max(16),
  })
  .strict();

export const aiUncertaintySchema = z
  .object({
    statement: boundedText(600),
    reason: boundedText(800),
    missingEvidence: z.array(boundedText(200)).max(8).optional(),
  })
  .strict();

export const aiGraphInstructionsSchema = z
  .object({
    emphasizeStageIds: boundedIds,
    emphasizeEvidenceIds: boundedIds,
    dimStageIds: boundedIds,
    openPanel: z.enum(["evidence", "findings", "resources", "screenshot", "none"]).optional(),
    selectedStageId: z.string().min(1).max(160).optional(),
    resourceFilter: z.enum(["all", "first-party", "third-party", "failed"]).optional(),
  })
  .strict();

export const aiDiagnosisDraftSchema = z
  .object({
    summary: boundedText(500),
    answer: boundedText(2_800),
    confidence: z.number().min(0).max(1),
    conclusionType: aiConclusionTypeSchema,
    primaryFinding: aiFindingSchema.optional(),
    relatedFindings: z.array(aiFindingSchema).max(6),
    prioritizedActions: z.array(aiActionSchema).max(6),
    evidenceReferences: z.array(aiEvidenceReferenceSchema).max(16),
    counterfactualReferences: z.array(aiCounterfactualReferenceSchema).max(16).optional(),
    uncertainties: z.array(aiUncertaintySchema).max(8),
    followUpQuestions: z.array(boundedText(240)).max(6),
    graphInstructions: aiGraphInstructionsSchema,
  })
  .strict();

export const aiDiagnosisSchema = aiDiagnosisDraftSchema
  .extend({
    id: z.string().min(1).max(160),
    question: boundedText(500),
    generatedAt: z.string().datetime(),
    model: z.string().min(1).max(180),
    promptVersion: z.string().min(1).max(80),
    source: z.enum(["workers-ai", "fixture", "evidence-guard"]),
  })
  .strict();

export const diagnoseInvestigationRequestSchema = z
  .object({
    question: boundedText(500),
    expertiseMode: aiExpertiseModeSchema,
    investigation: investigationSchema,
    selectedStageId: z.string().min(1).max(160).optional(),
    counterfactualContext: counterfactualAiContextSchema.optional(),
  })
  .strict();

export const aiUsageSummarySchema = z
  .object({
    model: z.string().min(1).max(180),
    promptVersion: z.string().min(1).max(80),
    gateway: z.string().min(1).max(80),
    gatewayLogId: z.string().max(180).optional(),
    promptTokens: z.number().int().nonnegative().optional(),
    completionTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
    inputCharacters: z.number().int().nonnegative(),
    outputCharacters: z.number().int().nonnegative(),
    toolCalls: z.array(z.string().min(1).max(80)).max(8),
    fixture: z.boolean(),
    omittedEvidenceCount: z.number().int().nonnegative(),
    omittedResourceCount: z.number().int().nonnegative(),
  })
  .strict();

export const diagnoseInvestigationResponseSchema = z
  .object({
    diagnosis: aiDiagnosisSchema,
    usage: aiUsageSummarySchema.optional(),
  })
  .strict();

export const aiInvestigationErrorResponseSchema = z
  .object({ error: investigationApiErrorSchema })
  .strict();

export type AiExpertiseMode = z.infer<typeof aiExpertiseModeSchema>;
export type AiConclusionType = z.infer<typeof aiConclusionTypeSchema>;
export type AiCategory = z.infer<typeof aiCategorySchema>;
export type AiFinding = z.infer<typeof aiFindingSchema>;
export type AiAction = z.infer<typeof aiActionSchema>;
export type AiEvidenceReference = z.infer<typeof aiEvidenceReferenceSchema>;
export type AiCounterfactualReference = z.infer<typeof aiCounterfactualReferenceSchema>;
export type CounterfactualAiContext = z.infer<typeof counterfactualAiContextSchema>;
export type AiUncertainty = z.infer<typeof aiUncertaintySchema>;
export type AiGraphInstructions = z.infer<typeof aiGraphInstructionsSchema>;
export type AiDiagnosisDraft = z.infer<typeof aiDiagnosisDraftSchema>;
export type AiDiagnosis = z.infer<typeof aiDiagnosisSchema>;
export type DiagnoseInvestigationRequest = z.infer<typeof diagnoseInvestigationRequestSchema>;
export type AiUsageSummary = z.infer<typeof aiUsageSummarySchema>;
export type DiagnoseInvestigationResponse = z.infer<typeof diagnoseInvestigationResponseSchema>;
