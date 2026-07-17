import type { AiCategory, AiExpertiseMode } from "../../features/investigation/aiSchema";
import type { EvidenceItem, Investigation } from "../../features/investigation/schema";

export type InvestigationIntent =
  | "performance"
  | "cache"
  | "dns"
  | "tls"
  | "redirect"
  | "browser"
  | "third-party"
  | "security"
  | "broad";

export interface SelectedAiEvidence {
  id: string;
  stageId: string;
  category: AiCategory;
  label: string;
  value: unknown;
  confidence: EvidenceItem["confidence"];
  source: string;
  limitation?: string;
}

export interface EvidenceOmissionSummary {
  omittedEvidenceCount: number;
  omittedResourceCount: number;
  reasons: string[];
}

export interface InvestigationEvidenceContext {
  intent: InvestigationIntent;
  expertiseMode: AiExpertiseMode;
  summary: {
    investigationId: string;
    requestedUrl: string;
    normalizedUrl: string;
    status: Investigation["status"];
    summary: string;
    stages: Array<{
      id: string;
      type: string;
      status: string;
      title: string;
      durationMs?: number;
    }>;
    metrics: Investigation["metrics"];
    findings: Array<{
      id: string;
      category: string;
      severity: string;
      title: string;
      explanation: string;
      evidenceIds: string[];
    }>;
    limitations: string[];
  };
  evidence: SelectedAiEvidence[];
  omission: EvidenceOmissionSummary;
  serialized: string;
}

export interface AiToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface AiToolResult {
  callId: string;
  name: string;
  output: unknown;
  serializedCharacters: number;
}

export interface AiModelUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AiPlanningResult {
  toolCalls: AiToolCall[];
  usage?: AiModelUsage;
  gatewayLogId?: string;
}

export interface AiModelDiagnosisResult {
  output: unknown;
  rawCharacters: number;
  usage?: AiModelUsage;
  gatewayLogId?: string;
}
