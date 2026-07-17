import type { AiDiagnosisDraft } from "../../features/investigation/aiSchema";
import type { InvestigationAiClient } from "./client";
import type { AiModelDiagnosisResult, AiPlanningResult } from "./types";

export class FixtureAiClient implements InvestigationAiClient {
  plan(): Promise<AiPlanningResult> {
    return Promise.resolve({ toolCalls: [] });
  }

  diagnose(
    input: Parameters<InvestigationAiClient["diagnose"]>[0],
  ): Promise<AiModelDiagnosisResult> {
    const evidence = input.context.evidence[0];
    const finding = input.context.summary.findings[0];
    if (!evidence) {
      return Promise.resolve({
        output: inconclusiveDraft("No relevant verified evidence is available for this question."),
        rawCharacters: 500,
      });
    }
    const draft: AiDiagnosisDraft = {
      summary: finding?.title ?? "The recorded evidence supports a bounded observation.",
      answer:
        finding?.explanation ??
        `The collected ${evidence.label.toLowerCase()} is the strongest relevant signal. It supports an observation, but not an unmeasured causal claim.`,
      confidence: finding ? Math.min(0.88, 0.55 + (finding.severity === "high" ? 0.2 : 0.1)) : 0.58,
      conclusionType: finding ? "supported" : "likely",
      primaryFinding: {
        title: finding?.title ?? evidence.label,
        explanation:
          finding?.explanation ?? "This is the highest-ranked evidence relevant to the question.",
        category: evidence.category,
        severity: (finding?.severity ?? "info") as "info" | "low" | "medium" | "high",
        confidence: finding ? 0.8 : 0.58,
        evidenceIds: [evidence.id],
        ...(finding ? { deterministicFindingIds: [finding.id] } : {}),
      },
      relatedFindings: [],
      prioritizedActions: [
        {
          priority: 1,
          title: "Verify with another controlled run",
          rationale:
            "A repeated measurement can distinguish a stable condition from a single lab observation.",
          evidenceIds: [evidence.id],
          expectedImpact: "unknown",
        },
      ],
      evidenceReferences: [
        {
          evidenceId: evidence.id,
          stageId: evidence.stageId,
          claim: `The investigation recorded ${evidence.label}.`,
        },
      ],
      uncertainties: [
        {
          statement: "This fixture diagnosis does not establish causation.",
          reason:
            evidence.limitation ??
            "The investigation is a bounded observation rather than a controlled experiment.",
        },
      ],
      followUpQuestions: ["Which related stage should I inspect next?"],
      graphInstructions: {
        emphasizeStageIds: [evidence.stageId],
        emphasizeEvidenceIds: [evidence.id],
        dimStageIds: [],
        selectedStageId: evidence.stageId,
        openPanel: "evidence",
      },
    };
    const serialized = JSON.stringify(draft);
    return Promise.resolve({ output: draft, rawCharacters: serialized.length });
  }
}

export function inconclusiveDraft(reason: string): AiDiagnosisDraft {
  return {
    summary: "The available evidence is not sufficient for a reliable diagnosis.",
    answer: reason,
    confidence: 0.2,
    conclusionType: "inconclusive",
    relatedFindings: [],
    prioritizedActions: [],
    evidenceReferences: [],
    uncertainties: [{ statement: "No supported conclusion is available.", reason }],
    followUpQuestions: ["Can the investigation collect the missing stage evidence in another run?"],
    graphInstructions: {
      emphasizeStageIds: [],
      emphasizeEvidenceIds: [],
      dimStageIds: [],
      openPanel: "none",
    },
  };
}
