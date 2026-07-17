import type { Finding } from "../../features/investigation/schema";
import type { CacheAnalysis } from "../diagnostics/cache";
import type { SecurityHeaderCheck } from "../diagnostics/securityHeaders";
import type { HttpDiagnosticResult } from "../diagnostics/types";

export interface HttpFindingEvidence {
  cacheDispositionId?: string;
  cacheEdgeId?: string;
  responseStatusId?: string;
  serverHeaderId?: string;
  redirectEvidenceIds: string[];
  securityCheckIds: Partial<Record<SecurityHeaderCheck["id"], string>>;
}

const severityOrder: Record<Finding["severity"], number> = {
  high: 0,
  medium: 1,
  low: 2,
  info: 3,
};

function referenced(id: string | undefined): string[] {
  return id ? [id] : [];
}

export function createHttpFindings(
  diagnostic: HttpDiagnosticResult,
  cache: CacheAnalysis | undefined,
  security: SecurityHeaderCheck[],
  evidence: HttpFindingEvidence,
): Finding[] {
  const findings: Finding[] = [];

  if (diagnostic.redirects.length >= 2 && evidence.redirectEvidenceIds.length > 0) {
    findings.push({
      id: "finding-redirect-chain",
      severity: diagnostic.redirects.length >= 4 ? "medium" : "low",
      category: "redirect",
      title: `${diagnostic.redirects.length} sequential redirects observed`,
      explanation:
        "Each redirect requires another request before the final document can be received. The measured hop durations show the added serial work.",
      evidenceIds: evidence.redirectEvidenceIds,
      recommendation:
        "Link directly to the final canonical URL where the redirects are not required.",
      confidence: 1,
    });
  }

  if (diagnostic.finalResponse && diagnostic.finalResponse.status >= 400) {
    findings.push({
      id: "finding-http-status",
      severity: diagnostic.finalResponse.status >= 500 ? "high" : "medium",
      category: "origin",
      title: `Final response returned HTTP ${diagnostic.finalResponse.status}`,
      explanation:
        "The remote endpoint returned an unsuccessful document status. This confirms the response outcome but not its underlying cause.",
      evidenceIds: referenced(evidence.responseStatusId),
      recommendation:
        "Review the application or routing logs associated with this response status.",
      confidence: 1,
    });
  }

  if (cache) {
    if (cache.conflictingEvidence) {
      findings.push({
        id: "finding-cache-conflict",
        severity: "medium",
        category: "cache",
        title: "Cache signals conflict",
        explanation:
          "The response combines directives and observed cache behavior that do not agree. Packet Journey cannot safely reduce this to a single caching conclusion.",
        evidenceIds: [evidence.cacheDispositionId, evidence.cacheEdgeId].filter(
          (id): id is string => Boolean(id),
        ),
        recommendation: "Review the response cache directives and CDN cache rules together.",
        confidence: 1,
      });
    } else if (cache.disposition === "missing-directives") {
      findings.push({
        id: "finding-cache-missing",
        severity: "low",
        category: "cache",
        title: "No explicit cache policy observed",
        explanation:
          "The final response supplied neither Cache-Control nor Expires. Intermediaries and browsers therefore have less explicit guidance.",
        evidenceIds: referenced(evidence.cacheDispositionId),
        recommendation: "Set an intentional Cache-Control policy appropriate for this document.",
        confidence: 1,
      });
    } else if (["private", "no-store", "no-cache"].includes(cache.disposition)) {
      findings.push({
        id: "finding-cache-restricted",
        severity: "info",
        category: "cache",
        title: `Cache policy is ${cache.disposition}`,
        explanation:
          "The observed directive restricts storage or reuse. This may be intentional for personalized or sensitive content.",
        evidenceIds: referenced(evidence.cacheDispositionId),
        recommendation:
          "Confirm that the restrictive policy matches the document's data sensitivity.",
        confidence: 1,
      });
    }

    if (cache.edgeEvidence === "miss") {
      findings.push({
        id: "finding-cache-miss",
        severity: "info",
        category: "cache",
        title: "Cache-miss evidence observed",
        explanation:
          "The target response headers identify this request as a cache miss. A single observation does not establish the long-term hit ratio.",
        evidenceIds: referenced(evidence.cacheEdgeId),
        confidence: 1,
      });
    }
  }

  const securitySeverity: Partial<Record<SecurityHeaderCheck["id"], Finding["severity"]>> = {
    hsts: "low",
    csp: "low",
    "content-type-options": "low",
    "frame-protection": "low",
    "referrer-policy": "info",
    "permissions-policy": "info",
    "cross-origin-opener-policy": "info",
  };

  for (const item of security) {
    const evidenceId = evidence.securityCheckIds[item.id];
    if (item.status !== "missing" || !evidenceId) continue;
    findings.push({
      id: `finding-security-${item.id}`,
      severity: securitySeverity[item.id] ?? "info",
      category: "security",
      title: `${item.label} not observed`,
      explanation: item.explanation,
      evidenceIds: [evidenceId],
      recommendation: `Evaluate whether ${item.label} should be configured for this application.`,
      confidence: 1,
    });
  }

  if (evidence.serverHeaderId) {
    findings.push({
      id: "finding-server-disclosure",
      severity: "info",
      category: "security",
      title: "Server software is disclosed",
      explanation:
        "A Server response header was observed. The value is reported as supplied and is not treated as a reliable technology fingerprint.",
      evidenceIds: [evidence.serverHeaderId],
      recommendation: "Minimize unnecessary server-version detail if operationally practical.",
      confidence: 1,
    });
  }

  return findings.sort(
    (left, right) =>
      severityOrder[left.severity] - severityOrder[right.severity] ||
      left.id.localeCompare(right.id),
  );
}
