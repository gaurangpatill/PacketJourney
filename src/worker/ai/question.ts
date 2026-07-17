import type { InvestigationIntent } from "./types";

export class AiQuestionError extends Error {
  constructor(
    readonly code: "invalid_question" | "unsupported_question",
    message: string,
  ) {
    super(message);
    this.name = "AiQuestionError";
  }
}

const CAPABILITY_ABUSE =
  /system\s+prompt|reveal.{0,24}(prompt|secret|token)|environment\s+variable|api[_ -]?key|execute\s+(code|shell)|run\s+(code|command)|fetch\s+https?:|169\.254\.169\.254|ignore\s+(all|previous)\s+instructions/i;
const RELATED_TOPIC =
  /journey|page|site|website|slow|fast|performance|cache|cached|dns|domain|tls|certificate|redirect|origin|edge|header|security|third.?party|resource|script|render|browser|console|failure|failed|evidence|finding|fix|improve|latency|request|response|explain|uncertain|bottleneck/i;

function excessiveRepetition(question: string): boolean {
  const words = question.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  if (words.length < 12) return false;
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  return Math.max(...counts.values()) / words.length > 0.55;
}

export function validateAiQuestion(value: string): string {
  const question = value.trim().replace(/\s+/g, " ");
  if (question.length < 4 || question.length > 500) {
    throw new AiQuestionError("invalid_question", "Ask a question between 4 and 500 characters.");
  }
  if (CAPABILITY_ABUSE.test(question)) {
    throw new AiQuestionError(
      "unsupported_question",
      "The AI investigator cannot reveal prompts, access secrets, execute code, or make arbitrary network requests.",
    );
  }
  if (excessiveRepetition(question)) {
    throw new AiQuestionError("invalid_question", "The question contains excessive repetition.");
  }
  if (!RELATED_TOPIC.test(question)) {
    throw new AiQuestionError(
      "unsupported_question",
      "Ask about this investigation's network, caching, security, or browser evidence.",
    );
  }
  return question;
}

export function classifyInvestigationIntent(question: string): InvestigationIntent {
  const value = question.toLowerCase();
  if (/cache|cached|cache-control|freshness|revalid/.test(value)) return "cache";
  if (/dns|cname|resolver|ttl|aaaa|record/.test(value)) return "dns";
  if (/tls|certificate|cert|issuer|san|https/.test(value)) return "tls";
  if (/redirect|301|302|307|308|location/.test(value)) return "redirect";
  if (/security|header|csp|hsts|frame|permission|referrer/.test(value)) return "security";
  if (/third.?party|analytics|advert|external service|vendor/.test(value)) return "third-party";
  if (/render|browser|fcp|paint|script|resource|console|waterfall/.test(value)) return "browser";
  if (/slow|performance|bottleneck|latency|speed|largest|fix first|improve/.test(value)) {
    return "performance";
  }
  return "broad";
}
