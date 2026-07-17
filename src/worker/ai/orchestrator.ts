import {
  aiDiagnosisSchema,
  aiUsageSummarySchema,
  type AiDiagnosis,
  type AiExpertiseMode,
  type AiUsageSummary,
} from "../../features/investigation/aiSchema";
import type { Investigation } from "../../features/investigation/schema";
import { AI_PROMPT_VERSION, type AiRuntimeConfig } from "./config";
import type { InvestigationAiClient } from "./client";
import { selectInvestigationEvidence, relevantEvidenceForIntent } from "./evidenceSelection";
import { inconclusiveDraft } from "./fixture";
import { validateAiQuestion } from "./question";
import { executeAiToolCalls } from "./toolRegistry";
import type { AiModelUsage } from "./types";
import { validateAiDiagnosisOutput } from "./validation";

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

function completeDiagnosis(input: {
  draft: ReturnType<typeof inconclusiveDraft>;
  question: string;
  model: string;
  source: AiDiagnosis["source"];
}): AiDiagnosis {
  return aiDiagnosisSchema.parse({
    ...input.draft,
    id: crypto.randomUUID(),
    question: input.question,
    generatedAt: new Date().toISOString(),
    model: input.model,
    promptVersion: AI_PROMPT_VERSION,
    source: input.source,
  });
}

export async function diagnoseInvestigation(input: {
  investigation: Investigation;
  question: string;
  expertiseMode: AiExpertiseMode;
  selectedStageId?: string;
  client: InvestigationAiClient;
  config: AiRuntimeConfig;
}): Promise<AiInvestigationResult> {
  const question = validateAiQuestion(input.question);
  if (
    input.selectedStageId &&
    !input.investigation.stages.some((stage) => stage.id === input.selectedStageId)
  ) {
    throw new Error("The selected stage is not part of this investigation.");
  }
  const context = selectInvestigationEvidence({
    investigation: input.investigation,
    question,
    expertiseMode: input.expertiseMode,
    selectedStageId: input.selectedStageId,
    maximumCharacters: input.config.maximumInputCharacters,
  });
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

  const planning =
    input.config.maximumToolRounds > 0 && input.config.maximumModelRequests > 1
      ? await input.client.plan({ question, context, config: input.config })
      : { toolCalls: [] };
  const toolResults = executeAiToolCalls({
    investigation: input.investigation,
    calls: planning.toolCalls,
    maximumCalls: Math.min(input.config.maximumToolsPerRound, input.config.maximumTotalToolCalls),
  });
  const modelResult = await input.client.diagnose({
    question,
    context,
    toolResults,
    config: input.config,
  });
  const draft = validateAiDiagnosisOutput(modelResult.output, input.investigation);
  const diagnosis = completeDiagnosis({
    draft,
    question,
    model: input.config.fixtureMode ? `fixture:${input.config.modelKey}` : input.config.model,
    source: input.config.fixtureMode ? "fixture" : "workers-ai",
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
