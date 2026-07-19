import {
  aiDiagnosisSchema,
  aiUsageSummarySchema,
  type AiDiagnosis,
  type AiExpertiseMode,
  type AiUsageSummary,
  type CounterfactualAiContext,
} from "../../features/investigation/aiSchema";
import type { Investigation } from "../../features/investigation/schema";
import { AI_PROMPT_VERSION, type AiRuntimeConfig } from "./config";
import type { InvestigationAiClient } from "./client";
import { selectInvestigationEvidence, relevantEvidenceForIntent } from "./evidenceSelection";
import { inconclusiveDraft } from "./fixture";
import { validateAiQuestion } from "./question";
import { executeAiToolCalls } from "./toolRegistry";
import type { AiModelUsage } from "./types";
import { AiOutputError, validateAiDiagnosisOutput } from "./validation";
import type { ReferenceRetriever } from "../references/retrieval";
import type { ReferenceRetrievalResult } from "../../features/references/schema";
import { logEvent } from "../logging";
import { deterministicStatusDraft } from "./deterministicDiagnosis";

export interface AiInvestigationResult {
  diagnosis: AiDiagnosis;
  usage: AiUsageSummary;
}

function mergeUsage(...values: Array<AiModelUsage | undefined>): AiModelUsage {
  const sum = (key: keyof AiModelUsage) => {
    const numbers = values
      .map((value) => value?.[key])
      .filter((value): value is number => value !== undefined);
    return numbers.length ? numbers.reduce((total, value) => total + value, 0) : undefined;
  };
  return {
    promptTokens: sum("promptTokens"),
    completionTokens: sum("completionTokens"),
    totalTokens: sum("totalTokens"),
  };
}

function shouldPlanWithModel(
  context: ReturnType<typeof selectInvestigationEvidence>,
  config: AiRuntimeConfig,
): boolean {
  if (config.maximumToolRounds === 0 || config.maximumModelRequests <= 1) return false;
  if (context.intent !== "broad" && context.intent !== "performance") return false;
  return context.omission.omittedEvidenceCount > 0 || context.omission.omittedResourceCount > 0;
}

function completeDiagnosis(input: {
  draft: ReturnType<typeof inconclusiveDraft>;
  question: string;
  model: string;
  source: AiDiagnosis["source"];
  retrieval?: ReferenceRetrievalResult;
}): AiDiagnosis {
  return aiDiagnosisSchema.parse({
    ...input.draft,
    id: crypto.randomUUID(),
    question: input.question,
    generatedAt: new Date().toISOString(),
    model: input.model,
    promptVersion: AI_PROMPT_VERSION,
    source: input.source,
    referenceCitations: input.retrieval?.citations ?? [],
    ...(input.retrieval ? { retrievalMetadata: input.retrieval.metadata } : {}),
  });
}

export async function diagnoseInvestigation(input: {
  investigation: Investigation;
  question: string;
  expertiseMode: AiExpertiseMode;
  selectedStageId?: string;
  counterfactualContext?: CounterfactualAiContext;
  client: InvestigationAiClient;
  config: AiRuntimeConfig;
  referenceMode?: "none" | "authoritative";
  referenceRetriever?: ReferenceRetriever;
}): Promise<AiInvestigationResult> {
  const question = validateAiQuestion(input.question);
  if (
    input.selectedStageId &&
    !input.investigation.stages.some((stage) => stage.id === input.selectedStageId)
  ) {
    throw new Error("The selected stage is not part of this investigation.");
  }
  const counterfactualSerialized = input.counterfactualContext
    ? JSON.stringify({ counterfactual: input.counterfactualContext })
    : "";
  const context = selectInvestigationEvidence({
    investigation: input.investigation,
    question,
    expertiseMode: input.expertiseMode,
    selectedStageId: input.selectedStageId,
    maximumCharacters: Math.max(
      4_000,
      input.config.maximumInputCharacters - counterfactualSerialized.length - 80,
    ),
  });
  if (input.counterfactualContext) {
    context.counterfactual = input.counterfactualContext;
    context.serialized = `${context.serialized}\nCOUNTERFACTUAL PROVENANCE:\n${counterfactualSerialized}`;
  }
  const relevant = relevantEvidenceForIntent(context);
  if (relevant.length === 0) {
    const diagnosis = completeDiagnosis({
      draft: inconclusiveDraft(
        `This investigation did not collect evidence relevant to the ${context.intent} question. Packet Journey will not substitute assumptions for missing measurements.`,
      ),
      question,
      model: "deterministic-evidence-guard",
      source: "evidence-guard",
    });
    return {
      diagnosis,
      usage: aiUsageSummarySchema.parse({
        model: diagnosis.model,
        promptVersion: AI_PROMPT_VERSION,
        gateway: input.config.gatewayId,
        inputCharacters: context.serialized.length,
        outputCharacters: JSON.stringify(diagnosis).length,
        toolCalls: [],
        fixture: false,
        omittedEvidenceCount: context.omission.omittedEvidenceCount,
        omittedResourceCount: context.omission.omittedResourceCount,
      }),
    };
  }

  const deterministicDraft = deterministicStatusDraft({
    question,
    context,
    investigation: input.investigation,
  });
  if (deterministicDraft) {
    const retrieval =
      input.referenceMode === "authoritative" && input.referenceRetriever
        ? await input.referenceRetriever.retrieve({
            question,
            investigation: input.investigation,
            expertiseMode: input.expertiseMode,
          })
        : undefined;
    const diagnosis = completeDiagnosis({
      draft: deterministicDraft,
      question,
      model: "deterministic-evidence-guard",
      source: "evidence-guard",
      retrieval,
    });
    return {
      diagnosis,
      usage: aiUsageSummarySchema.parse({
        model: diagnosis.model,
        promptVersion: AI_PROMPT_VERSION,
        gateway: input.config.gatewayId,
        inputCharacters: context.serialized.length,
        outputCharacters: JSON.stringify(diagnosis).length,
        toolCalls: [],
        fixture: false,
        omittedEvidenceCount: context.omission.omittedEvidenceCount,
        omittedResourceCount: context.omission.omittedResourceCount,
      }),
    };
  }

  const planningRequired = shouldPlanWithModel(context, input.config);
  const planning = planningRequired
    ? await input.client.plan({ question, context, config: input.config })
    : { toolCalls: [] };
  if (!planningRequired) {
    logEvent("info", "ai.planning.skipped", {
      investigationId: input.investigation.id,
      intent: context.intent,
      reason: "selected-evidence-sufficient",
    });
  }
  logEvent("info", "ai.planning.completed", {
    investigationId: input.investigation.id,
    toolCalls: planning.toolCalls.map((call) => ({
      name: call.name,
      argumentType: Array.isArray(call.arguments) ? "array" : typeof call.arguments,
      arguments:
        call.arguments && typeof call.arguments === "object" ? call.arguments : "invalid-shape",
    })),
  });
  const toolResults = executeAiToolCalls({
    investigation: input.investigation,
    calls: planning.toolCalls,
    maximumCalls: Math.min(input.config.maximumToolsPerRound, input.config.maximumTotalToolCalls),
  });
  const retrieval =
    input.referenceMode === "authoritative" && input.referenceRetriever
      ? await input.referenceRetriever.retrieve({
          question,
          investigation: input.investigation,
          expertiseMode: input.expertiseMode,
        })
      : undefined;
  const modelResult = await input.client.diagnose({
    question,
    context,
    toolResults,
    config: input.config,
    references: retrieval?.citations ?? [],
  });
  let validationFallback = false;
  let draft: ReturnType<typeof validateAiDiagnosisOutput>;
  try {
    draft = validateAiDiagnosisOutput(
      modelResult.output,
      input.investigation,
      input.counterfactualContext,
      new Set(retrieval?.citations.map((citation) => citation.citationId) ?? []),
    );
  } catch (error) {
    if (!(error instanceof AiOutputError)) throw error;
    validationFallback = true;
    logEvent("warn", "ai.output.rejected", {
      investigationId: input.investigation.id,
      validationCode: error.code,
      validationMessage: error.message.slice(0, 400),
    });
    draft = inconclusiveDraft(
      "Workers AI returned a response that Packet Journey could not safely validate against the collected evidence. No model conclusion was displayed.",
    );
  }
  const diagnosis = completeDiagnosis({
    draft,
    question,
    model: validationFallback
      ? "deterministic-evidence-guard"
      : input.config.fixtureMode
        ? `fixture:${input.config.modelKey}`
        : input.config.model,
    source: validationFallback
      ? "evidence-guard"
      : input.config.fixtureMode
        ? "fixture"
        : "workers-ai",
    retrieval,
  });
  const tokenUsage = mergeUsage(planning.usage, modelResult.usage);
  const usage = aiUsageSummarySchema.parse({
    model: diagnosis.model,
    promptVersion: AI_PROMPT_VERSION,
    gateway: input.config.gatewayId,
    gatewayLogId: modelResult.gatewayLogId ?? planning.gatewayLogId,
    ...tokenUsage,
    inputCharacters: context.serialized.length,
    outputCharacters: modelResult.rawCharacters,
    toolCalls: toolResults.map((result) => result.name),
    fixture: input.config.fixtureMode,
    omittedEvidenceCount: context.omission.omittedEvidenceCount,
    omittedResourceCount: context.omission.omittedResourceCount,
  });
  return { diagnosis, usage };
}
