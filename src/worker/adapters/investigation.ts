import {
  investigationSchema,
  type EvidenceItem,
  type Investigation,
  type JourneyStage,
} from "../../features/investigation/schema";
import { analyzeCacheHeaders, type CacheAnalysis } from "../diagnostics/cache";
import {
  identifyInfrastructureClues,
  type InfrastructureClue,
} from "../diagnostics/infrastructure";
import { analyzeSecurityHeaders, type SecurityHeaderCheck } from "../diagnostics/securityHeaders";
import type { HttpDiagnosticResult } from "../diagnostics/types";
import { createHttpFindings, type HttpFindingEvidence } from "../findings/httpFindings";

export interface InvestigationAdapterOptions {
  id?: string;
}

function evidence(
  id: string,
  label: string,
  value: unknown,
  source: string,
  collectedAt: string,
  confidence: EvidenceItem["confidence"] = "verified",
): EvidenceItem {
  return { id, label, value, source, collectedAt, confidence };
}

function connectStages(stages: JourneyStage[]): void {
  for (let index = 0; index < stages.length - 1; index += 1) {
    const stage = stages[index];
    const next = stages[index + 1];
    if (stage && next) stage.connections = [next.id];
  }
}

function responseEvidence(
  diagnostic: HttpDiagnosticResult,
  clues: InfrastructureClue[],
): EvidenceItem[] {
  const response = diagnostic.finalResponse;
  if (!response) return [];

  const items = [
    evidence(
      "http-response-status",
      "Status",
      response.status,
      "Final HTTP response",
      response.collectedAt,
    ),
    evidence(
      "http-final-url",
      "Final URL",
      response.url,
      "Final HTTP response",
      response.collectedAt,
    ),
  ];

  for (const [name, value] of Object.entries(response.headers)) {
    items.push(
      evidence(
        `http-header-${name}`,
        `Header: ${name}`,
        value,
        `HTTP response header: ${name}`,
        response.collectedAt,
      ),
    );
  }
  if (response.headersTruncated) {
    items.push(
      evidence(
        "http-headers-truncated",
        "Header evidence truncated",
        true,
        "Worker header safety limit",
        response.collectedAt,
      ),
    );
  }
  for (const clue of clues) {
    items.push(
      evidence(
        `http-clue-${clue.id}`,
        `Clue: ${clue.label}`,
        clue.value,
        `Deterministic rule from ${clue.sourceHeader}`,
        response.collectedAt,
        clue.confidence,
      ),
    );
  }
  return items;
}

function cacheEvidence(analysis: CacheAnalysis, collectedAt: string): EvidenceItem[] {
  return [
    evidence(
      "cache-disposition",
      "Cache disposition",
      analysis.disposition,
      "Deterministic Cache-Control and Expires analysis",
      collectedAt,
      "inferred",
    ),
    evidence(
      "cache-edge-evidence",
      "Observed cache result",
      analysis.edgeEvidence,
      "Deterministic cf-cache-status and Age analysis",
      collectedAt,
      analysis.edgeEvidence === "unknown" ? "inferred" : "verified",
    ),
    evidence(
      "cache-directives",
      "Parsed cache directives",
      analysis.directives,
      "Deterministic Cache-Control parser",
      collectedAt,
      "inferred",
    ),
    evidence(
      "cache-revalidation-validator",
      "Revalidation validator present",
      analysis.hasRevalidationValidator,
      "ETag and Last-Modified presence check",
      collectedAt,
    ),
    evidence(
      "cache-conflicting-signals",
      "Conflicting cache signals",
      analysis.conflictingEvidence,
      "Deterministic cache evidence comparison",
      collectedAt,
      "inferred",
    ),
    evidence(
      "cache-analysis-reasons",
      "Analysis reasons",
      analysis.reasons,
      "Deterministic cache rules",
      collectedAt,
      "inferred",
    ),
  ];
}

function securityEvidence(checks: SecurityHeaderCheck[], collectedAt: string): EvidenceItem[] {
  return checks.map((item) =>
    evidence(
      `security-check-${item.id}`,
      `Security check: ${item.label}`,
      {
        status: item.status,
        explanation: item.explanation,
        sourceHeaders: item.sourceHeaders,
      },
      "Deterministic security-header presence check",
      collectedAt,
    ),
  );
}

function responseDescription(hasEdge: boolean, inferredEdge: boolean): string {
  if (hasEdge && inferredEdge) {
    return "The final headers suggest an intermediary response path; the underlying topology is not directly confirmed.";
  }
  if (hasEdge) {
    return "The final response included target-supplied edge headers. No origin traversal is assumed beyond those headers.";
  }
  return "The remote HTTP endpoint returned the final response headers; its internal topology is not observable here.";
}

export function adaptHttpDiagnosticToInvestigation(
  diagnostic: HttpDiagnosticResult,
  options: InvestigationAdapterOptions = {},
): Investigation {
  const stages: JourneyStage[] = [];
  const host = new URL(diagnostic.normalizedUrl.canonicalUrl).hostname;
  const inputEvidence = [
    evidence(
      "input-requested-url",
      "Submitted URL",
      diagnostic.requestedUrl,
      "User input",
      diagnostic.startedAt,
    ),
    evidence(
      "input-normalized-url",
      "Normalized URL",
      diagnostic.normalizedUrl.canonicalUrl,
      "Canonical URL normalizer",
      diagnostic.startedAt,
    ),
    evidence(
      "input-safety-policy",
      "Public destination policy",
      "passed",
      "Worker SSRF policy and DNS preflight",
      diagnostic.startedAt,
    ),
  ];

  stages.push({
    id: "input",
    type: "input",
    title: "Normalized request URL",
    shortTitle: "Input URL",
    description: "The Worker normalized the submitted public HTTP(S) destination before fetching.",
    status: "success",
    startedAt: diagnostic.startedAt,
    completedAt: diagnostic.startedAt,
    evidence: inputEvidence,
    connections: [],
    branch: 0,
  });

  const redirectEvidenceIds: string[] = [];
  for (const hop of diagnostic.redirects) {
    const number = hop.index + 1;
    const statusId = `redirect-${number}-status`;
    redirectEvidenceIds.push(statusId);
    const hopEvidence = [
      evidence(statusId, "Status", hop.status, "Redirect HTTP response", hop.collectedAt),
      evidence(
        `redirect-${number}-source`,
        "Source URL",
        hop.sourceUrl,
        "Redirect HTTP response",
        hop.collectedAt,
      ),
      evidence(
        `redirect-${number}-location`,
        "Location",
        hop.location ?? "missing",
        "Redirect Location header",
        hop.collectedAt,
      ),
      evidence(
        `redirect-${number}-destination`,
        "Destination",
        hop.destinationUrl ?? "unavailable",
        "Canonical redirect resolver",
        hop.collectedAt,
      ),
      evidence(
        `redirect-${number}-validation`,
        "Destination validation",
        hop.destinationValidation,
        "Worker SSRF redirect policy",
        hop.collectedAt,
      ),
      evidence(
        `redirect-${number}-headers`,
        "Response headers",
        hop.headers,
        "Allowlisted redirect response headers",
        hop.collectedAt,
      ),
    ];
    stages.push({
      id: `redirect-${number}`,
      type: "redirect",
      title: `HTTP ${hop.status} redirect`,
      shortTitle: `${hop.status} redirect`,
      description: hop.destinationUrl
        ? `The remote endpoint directed the next request to ${hop.destinationUrl}.`
        : "The redirect could not produce a safe destination.",
      status: hop.destinationValidation === "passed" ? "success" : "error",
      durationMs: hop.durationMs,
      completedAt: hop.collectedAt,
      evidence: hopEvidence,
      connections: [],
      branch: 0,
    });
  }

  let cache: CacheAnalysis | undefined;
  let security: SecurityHeaderCheck[] = [];
  const findingEvidence: HttpFindingEvidence = {
    redirectEvidenceIds,
    securityCheckIds: {},
  };

  if (diagnostic.finalResponse) {
    const response = diagnostic.finalResponse;
    const clues = identifyInfrastructureClues(response.headers);
    const edgeClue = clues.find((clue) =>
      ["cloudflare-edge", "cloudfront-clue", "proxy-clue"].includes(clue.id),
    );
    const hasEdge = Boolean(edgeClue);
    const inferredEdge = edgeClue?.confidence === "inferred";
    const items = responseEvidence(diagnostic, clues);
    findingEvidence.responseStatusId = "http-response-status";
    if (response.headers.server) findingEvidence.serverHeaderId = "http-header-server";

    stages.push({
      id: "http-response",
      type: hasEdge ? "edge" : "origin",
      title: "Final HTTP response",
      shortTitle: hasEdge ? "Edge response" : "HTTP response",
      description: responseDescription(hasEdge, inferredEdge),
      status: response.status >= 400 ? "warning" : "success",
      durationMs: response.durationMs,
      completedAt: response.collectedAt,
      evidence: items,
      connections: [],
      branch: 0,
    });

    cache = analyzeCacheHeaders(response.headers, new Date(response.collectedAt));
    findingEvidence.cacheDispositionId = "cache-disposition";
    findingEvidence.cacheEdgeId = "cache-edge-evidence";
    const cacheWarning =
      cache.disposition === "missing-directives" ||
      cache.disposition === "ambiguous" ||
      cache.conflictingEvidence;
    stages.push({
      id: "cache-analysis",
      type: "cache",
      title: "Deterministic cache analysis",
      shortTitle: "Cache analysis",
      description: cache.reasons[0] ?? "Cache behavior could not be classified.",
      status: cacheWarning ? "warning" : "success",
      completedAt: response.collectedAt,
      evidence: cacheEvidence(cache, response.collectedAt),
      connections: [],
      branch: 0,
    });

    security = analyzeSecurityHeaders(
      response.headers,
      new URL(response.url).protocol as "http:" | "https:",
    );
    const checks = securityEvidence(security, response.collectedAt);
    for (const item of security) {
      findingEvidence.securityCheckIds[item.id] = `security-check-${item.id}`;
    }
    stages.push({
      id: "document-received",
      type: "browser",
      title: "Document response received",
      shortTitle: "Document received",
      description:
        "The HTTP document response reached Packet Journey. No browser execution or rendering was performed in Layer 3.",
      status: response.status >= 400 ? "warning" : "success",
      completedAt: response.collectedAt,
      evidence: checks,
      connections: [],
      branch: 0,
    });
  }

  if (diagnostic.error) {
    stages.push({
      id: "terminal-error",
      type: "error",
      title: "HTTP investigation stopped",
      shortTitle: "Journey stopped",
      description: diagnostic.error.message,
      status: "error",
      completedAt: diagnostic.completedAt,
      evidence: [
        evidence(
          "terminal-error-code",
          "Error code",
          diagnostic.error.code,
          "HTTP diagnostic state machine",
          diagnostic.completedAt,
        ),
        evidence(
          "terminal-error-retryable",
          "Retryable",
          diagnostic.error.retryable,
          "HTTP diagnostic error classification",
          diagnostic.completedAt,
        ),
        evidence(
          "terminal-error-details",
          "Error details",
          diagnostic.error.details ?? {},
          "HTTP diagnostic state machine",
          diagnostic.completedAt,
        ),
      ],
      connections: [],
      branch: 0,
    });
  }

  connectStages(stages);
  const findings = createHttpFindings(diagnostic, cache, security, findingEvidence);
  const contentLength = Number.parseInt(
    diagnostic.finalResponse?.headers["content-length"] ?? "",
    10,
  );
  const investigation: Investigation = {
    id: options.id ?? `http-${crypto.randomUUID()}`,
    title: `HTTP journey for ${host}`,
    summary: diagnostic.error
      ? `The Worker preserved ${diagnostic.redirects.length} redirect hop${diagnostic.redirects.length === 1 ? "" : "s"} before the investigation stopped.`
      : `The Worker observed ${diagnostic.redirects.length} redirect hop${diagnostic.redirects.length === 1 ? "" : "s"} and HTTP ${diagnostic.finalResponse?.status ?? "unknown"} at the final URL.`,
    scenario: "live-http",
    url: diagnostic.normalizedUrl.canonicalUrl,
    normalizedUrl: diagnostic.normalizedUrl.canonicalUrl,
    status: diagnostic.error ? "failed" : "completed",
    createdAt: diagnostic.startedAt,
    completedAt: diagnostic.completedAt,
    stages,
    findings,
    metrics: {
      totalDurationMs: diagnostic.totalDurationMs,
      requestCount: diagnostic.redirects.length + (diagnostic.finalResponse ? 1 : 0),
      ...(Number.isFinite(contentLength) && contentLength >= 0
        ? { transferredBytes: contentLength }
        : {}),
    },
    artifacts: [],
    mock: false,
  };

  return investigationSchema.parse(investigation);
}
