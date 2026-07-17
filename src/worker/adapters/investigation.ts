import {
  investigationSchema,
  type EvidenceItem,
  type Investigation,
  type JourneyStage,
} from "../../features/investigation/schema";
import { analyzeCacheHeaders, type CacheAnalysis } from "../diagnostics/cache";
import type { CertificateDiagnosticResult } from "../diagnostics/certificate";
import type { DnsDiagnosticResult } from "../diagnostics/dns";
import {
  identifyInfrastructureClues,
  type InfrastructureClue,
} from "../diagnostics/infrastructure";
import { analyzeSecurityHeaders, type SecurityHeaderCheck } from "../diagnostics/securityHeaders";
import type { HttpDiagnosticResult, NetworkDiagnosticResult } from "../diagnostics/types";
import {
  createDnsTlsFindings,
  type CertificateFindingEvidence,
  type DnsFindingEvidence,
} from "../findings/dnsTlsFindings";
import { createHttpFindings, type HttpFindingEvidence } from "../findings/httpFindings";
import type { BrowserDiagnosticResult, BrowserResource } from "../browser/types";
import { createBrowserFindings, type BrowserFindingEvidence } from "../findings/browserFindings";

export interface InvestigationAdapterOptions {
  id?: string;
  network?: NetworkDiagnosticResult;
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

const findingSeverityOrder = { high: 0, medium: 1, low: 2, info: 3 } as const;

function browserResourceBranchStages(
  browser: BrowserDiagnosticResult,
  parentId: string,
): JourneyStage[] {
  const groups = new Map<
    string,
    { type: "resource" | "third-party"; title: string; resources: BrowserResource[] }
  >();
  for (const resource of browser.resources) {
    const key = resource.firstParty
      ? `resource:${resource.type}`
      : `third-party:${resource.thirdPartyCategory ?? "unknown"}`;
    const title = resource.firstParty
      ? `${resource.type} resources`
      : `${resource.thirdPartyCategory ?? "unknown"} dependencies`;
    const group = groups.get(key) ?? {
      type: resource.firstParty ? ("resource" as const) : ("third-party" as const),
      title,
      resources: [],
    };
    group.resources.push(resource);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort(
      (left, right) =>
        right[1].resources.length - left[1].resources.length || left[0].localeCompare(right[0]),
    )
    .slice(0, 12)
    .map(([key, group], index) => {
      const id = `browser-group-${index + 1}`;
      const failed = group.resources.filter((resource) => resource.failed).length;
      const bytes = group.resources.reduce(
        (total, resource) => total + (resource.transferSize ?? 0),
        0,
      );
      return {
        id,
        type: group.type,
        title: group.title,
        shortTitle: `${group.resources.length} ${group.title}`,
        description: `${group.resources.length} retained request${group.resources.length === 1 ? "" : "s"}${bytes > 0 ? ` · ${Math.round(bytes / 1_000)} kB` : ""}${failed > 0 ? ` · ${failed} failed` : ""}.`,
        status: failed > 0 ? "warning" : "success",
        completedAt: browser.completedAt,
        evidence: [
          evidence(
            `${id}-group-key`,
            "Resource group",
            key,
            "Deterministic browser resource aggregation",
            browser.completedAt,
            group.type === "third-party" ? "inferred" : "verified",
          ),
          evidence(
            `${id}-resources`,
            "Grouped resources",
            group.resources,
            "Cloudflare Browser Run resource and performance events",
            browser.completedAt,
          ),
          evidence(
            `${id}-parent`,
            "Browser relationship",
            parentId,
            "Canonical browser branch adapter",
            browser.completedAt,
            "inferred",
          ),
        ],
        connections: [],
        branch: index + 1,
      } satisfies JourneyStage;
    });
}

function browserStages(browser: BrowserDiagnosticResult): {
  core: JourneyStage[];
  branches: JourneyStage[];
  findingEvidence: BrowserFindingEvidence;
} {
  const statusId = "browser-status";
  const navigationId = "browser-navigation";
  const resourceSummaryId = "browser-resource-summary";
  const resourcesId = "browser-resources";
  const consoleId = "browser-console";
  const errorsId = "browser-errors";
  const screenshotId = browser.artifact ? "browser-screenshot" : undefined;
  const stageEvidence = [
    evidence(
      statusId,
      "Browser investigation status",
      { status: browser.status, readiness: browser.readiness },
      "Cloudflare Browser Run investigation state machine",
      browser.completedAt,
    ),
    evidence(
      navigationId,
      "Browser navigation",
      {
        requestedUrl: browser.requestedUrl,
        finalUrl: browser.finalUrl ?? "unavailable",
        title: browser.title ?? "unavailable",
        mainDocumentStatus: browser.mainDocumentStatus ?? "unavailable",
        mainDocumentContentType: browser.mainDocumentContentType ?? "unavailable",
        redirectCount: browser.redirectCount,
        viewport: browser.viewport,
        metrics: browser.navigation,
      },
      "Cloudflare Browser Run page navigation and Performance API",
      browser.completedAt,
    ),
    evidence(
      resourceSummaryId,
      "Browser resource summary",
      browser.resourceSummary,
      "Deterministic aggregation of Browser Run resource evidence",
      browser.completedAt,
      "inferred",
    ),
    evidence(
      resourcesId,
      "Browser resources",
      browser.resources,
      "Cloudflare Browser Run request, response, failure, and Resource Timing evidence",
      browser.completedAt,
    ),
    evidence(
      consoleId,
      "Browser console errors and warnings",
      { entries: browser.console, truncated: browser.consoleTruncated },
      "Cloudflare Browser Run console and page-error events",
      browser.completedAt,
    ),
    evidence(
      "browser-blocked-requests",
      "Browser requests blocked by safety policy",
      browser.blockedRequests,
      "Packet Journey browser navigation and subresource policy",
      browser.completedAt,
    ),
    evidence(
      errorsId,
      "Browser diagnostic errors",
      browser.errors,
      "Cloudflare Browser Run diagnostic state machine",
      browser.completedAt,
    ),
    evidence(
      "browser-limitations",
      "Browser evidence limitations",
      browser.limitations,
      "Browser diagnostic capability boundary",
      browser.completedAt,
    ),
  ];
  if (browser.artifact && screenshotId) {
    stageEvidence.push(
      evidence(
        screenshotId,
        "Screenshot artifact",
        browser.artifact,
        "Private R2 object metadata",
        browser.completedAt,
      ),
    );
  }
  const unavailable = browser.status === "unavailable";
  const failed = browser.status === "error";
  const navigationStage: JourneyStage = {
    id: "browser-investigation",
    type: "browser",
    title: unavailable ? "Browser investigation unavailable" : "Browser navigation and rendering",
    shortTitle: unavailable ? "Browser unavailable" : "Browser render",
    description: unavailable
      ? (browser.errors[0]?.message ?? "Browser evidence was unavailable.")
      : `One isolated lab browser session reached ${browser.readiness.replaceAll("-", " ")} and retained ${browser.resourceSummary.retained} resource records.`,
    status: failed ? "error" : browser.status === "partial" || unavailable ? "warning" : "success",
    startedAt: browser.startedAt,
    completedAt: browser.completedAt,
    durationMs: browser.durationMs,
    evidence: stageEvidence,
    connections: [],
    branch: 0,
  };
  const core = [navigationStage];
  if (!unavailable && !failed) {
    core.push({
      id: "browser-complete",
      type: "browser",
      title: "Browser evidence collected",
      shortTitle: "Browser complete",
      description: browser.artifact
        ? "Browser evidence and a private screenshot artifact were collected."
        : "Browser evidence was collected without a screenshot artifact.",
      status: browser.status === "partial" ? "warning" : "success",
      completedAt: browser.completedAt,
      evidence: [
        evidence(
          "browser-completion-readiness",
          "Completion state",
          browser.readiness,
          "Cloudflare Browser Run investigation state machine",
          browser.completedAt,
        ),
      ],
      connections: [],
      branch: 0,
    });
  }
  return {
    core,
    branches: unavailable || failed ? [] : browserResourceBranchStages(browser, navigationStage.id),
    findingEvidence: {
      browser,
      statusId,
      navigationId,
      resourceSummaryId,
      resourcesId,
      consoleId,
      errorsId,
      ...(screenshotId ? { screenshotId } : {}),
    },
  };
}

function dnsStage(
  result: DnsDiagnosticResult,
  index: number,
): { stage: JourneyStage; findingEvidence: DnsFindingEvidence } {
  const prefix = `dns-${index + 1}`;
  const recordsId = `${prefix}-records`;
  const aliasesId = `${prefix}-aliases`;
  const addressesId = `${prefix}-addresses`;
  const dnssecId = `${prefix}-dnssec`;
  const errorId = result.error ? `${prefix}-error` : undefined;
  const stageEvidence = [
    evidence(
      `${prefix}-summary`,
      "DNS summary",
      result.error
        ? result.error.message
        : `The domain points to ${result.addresses.filter((address) => address.assessment.allowed).length} public Internet address${result.addresses.filter((address) => address.assessment.allowed).length === 1 ? "" : "es"}${result.aliasChain.length > 0 ? ` through ${result.aliasChain.length} alias step${result.aliasChain.length === 1 ? "" : "s"}` : ""}.`,
      "Deterministic summary of observed DNS records",
      result.completedAt,
      "inferred",
    ),
    evidence(
      `${prefix}-hostname`,
      "Queried hostname",
      result.hostname,
      result.queries[0]?.source ?? "Canonical URL IP literal",
      result.completedAt,
    ),
    evidence(
      recordsId,
      "Normalized DNS records",
      result.records.map((record) => ({
        queriedHostname: record.queriedHostname,
        owner: record.owner,
        type: record.type,
        value: record.normalizedValue,
        ttl: record.ttl,
        directlyObserved: record.directlyObserved,
      })),
      result.queries[0]?.source ?? "Canonical URL IP literal",
      result.completedAt,
    ),
    evidence(
      aliasesId,
      "CNAME chain",
      result.aliasChain.map((step) => ({ from: step.from, to: step.to, ttl: step.ttl })),
      "Deterministic chain reconstruction from observed CNAME records",
      result.completedAt,
      "inferred",
    ),
    evidence(
      addressesId,
      "Address policy results",
      result.addresses.map((address) => ({
        hostname: address.hostname,
        type: address.recordType,
        address: address.assessment.address,
        ttl: address.ttl,
        range: address.assessment.range,
        allowed: address.assessment.allowed,
      })),
      "Shared Worker SSRF address policy applied to observed records",
      result.completedAt,
      "inferred",
    ),
    evidence(
      dnssecId,
      "Resolver-reported DNSSEC status",
      result.dnssec,
      result.dnssec.source,
      result.completedAt,
    ),
    evidence(
      `${prefix}-resolver-metadata`,
      "Resolver query metadata",
      result.queries.map((query) => ({
        hostname: query.hostname,
        recordType: query.recordType,
        responseStatus: query.response.Status,
        authenticatedData: query.response.AD ?? "unavailable",
        checkingDisabled: query.response.CD ?? "unavailable",
        truncated: query.response.TC ?? "unavailable",
        durationMs: query.durationMs,
        collectedAt: query.collectedAt,
      })),
      "Cloudflare 1.1.1.1 DNS-over-HTTPS JSON API",
      result.completedAt,
    ),
  ];
  if (result.error && errorId) {
    stageEvidence.push(
      evidence(
        errorId,
        "DNS diagnostic error",
        result.error,
        "DNS diagnostic state machine",
        result.completedAt,
      ),
    );
  }
  const addressCount = result.addresses.filter((address) => address.assessment.allowed).length;
  return {
    stage: {
      id: prefix,
      type: "dns",
      title: `DNS resolution for ${result.hostname}`,
      shortTitle: `DNS · ${result.hostname}`,
      description: result.error
        ? result.error.message
        : result.aliasChain.length > 0
          ? `${result.hostname} traversed ${result.aliasChain.length} alias step${result.aliasChain.length === 1 ? "" : "s"} to ${addressCount} public address${addressCount === 1 ? "" : "es"}.`
          : `${result.hostname} resolved to ${addressCount} public address${addressCount === 1 ? "" : "es"}.`,
      status: result.status,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      durationMs: result.durationMs,
      evidence: stageEvidence,
      connections: [],
      branch: 0,
    },
    findingEvidence: {
      result,
      recordsId,
      aliasesId,
      addressesId,
      dnssecId,
      ...(errorId ? { errorId } : {}),
    },
  };
}

function certificateStage(
  result: CertificateDiagnosticResult,
  index: number,
): { stage: JourneyStage; findingEvidence: CertificateFindingEvidence } {
  const prefix = `tls-${index + 1}`;
  const certificateId = result.certificate ? `${prefix}-certificate` : undefined;
  const validityId = result.certificate ? `${prefix}-validity` : undefined;
  const coverageId = result.certificate ? `${prefix}-hostname-coverage` : undefined;
  const limitationsId = `${prefix}-fetch-session-limitations`;
  const errorId = result.error ? `${prefix}-error` : undefined;
  const stageEvidence: EvidenceItem[] = [];

  if (result.certificate && certificateId && validityId && coverageId) {
    const certificate = result.certificate;
    stageEvidence.push(
      evidence(
        `${prefix}-summary`,
        "Certificate summary",
        certificate.observationKind === "certificate-transparency"
          ? `Certificate Transparency contains an issuance covering ${result.hostname}; this is not proof that the site currently serves it.`
          : certificate.hostnameCoverage.covered
            ? `The observed peer certificate covers ${result.hostname} and is ${certificate.validityStatus}.`
            : `The observed peer certificate does not cover ${result.hostname}.`,
        "Deterministic summary of independently observed certificate fields",
        certificate.collectedAt,
        "inferred",
      ),
      evidence(
        certificateId,
        "Normalized certificate",
        {
          requestedHostname: certificate.requestedHostname,
          ...(certificate.observationKind === "served-peer"
            ? {
                connectionHostname: certificate.connectionHostname,
                connectionAddress: certificate.connectionAddress,
              }
            : { validatedTargetAddress: certificate.connectionAddress }),
          subject: certificate.subject,
          subjectAlternativeNames: certificate.subjectAlternativeNames,
          sanValuesTruncated: certificate.sanValuesTruncated,
          issuer: certificate.issuer,
          serialNumber: certificate.serialNumber,
          fingerprint256: certificate.fingerprint256 ?? "unavailable",
          chain: certificate.chain,
          chainTruncated: certificate.chainTruncated,
          publicKeyAlgorithm: certificate.publicKeyAlgorithm,
          publicKeyBits: certificate.publicKeyBits ?? "unavailable",
          publicKeyCurve: certificate.publicKeyCurve ?? "unavailable",
          signatureAlgorithm: certificate.signatureAlgorithm,
          observationKind: certificate.observationKind,
        },
        certificate.source,
        certificate.collectedAt,
      ),
      evidence(
        validityId,
        "Certificate validity",
        {
          validFrom: certificate.validFrom,
          validUntil: certificate.validUntil,
          daysUntilExpiration: certificate.daysUntilExpiration,
          status: certificate.validityStatus,
        },
        certificate.source,
        certificate.collectedAt,
      ),
      evidence(
        coverageId,
        "Hostname coverage",
        certificate.hostnameCoverage,
        "Deterministic DNS SAN and common-name matcher",
        certificate.collectedAt,
        "inferred",
      ),
      evidence(
        limitationsId,
        "HTTP fetch TLS metadata",
        certificate.fetchSessionMetadata,
        "Cloudflare Worker runtime capability boundary",
        certificate.collectedAt,
      ),
    );
  } else {
    stageEvidence.push(
      evidence(
        `${prefix}-summary`,
        "Certificate summary",
        "Certificate details were unavailable from the independent probe; this does not show that the website certificate is invalid.",
        "Certificate diagnostic state machine",
        result.completedAt,
        "inferred",
      ),
      evidence(
        limitationsId,
        "HTTP fetch TLS metadata",
        {
          tlsVersion: "unavailable",
          cipherSuite: "unavailable",
          alpn: "unavailable",
          handshakeDurationMs: "unavailable",
          tcpDurationMs: "unavailable",
          explanation:
            "The normal Worker fetch does not expose these target-session fields, and the independent certificate probe did not complete.",
        },
        "Cloudflare Worker runtime capability boundary",
        result.completedAt,
      ),
    );
  }
  if (result.error && errorId) {
    stageEvidence.push(
      evidence(
        errorId,
        "Certificate inspection error",
        result.error,
        "Independent certificate probe state machine",
        result.completedAt,
      ),
    );
  }

  const certificate = result.certificate;
  const invalid =
    certificate &&
    (certificate.validityStatus === "expired" ||
      certificate.validityStatus === "not-yet-valid" ||
      !certificate.hostnameCoverage.covered);
  const expiringSoon =
    certificate?.daysUntilExpiration !== null &&
    certificate?.daysUntilExpiration !== undefined &&
    certificate.daysUntilExpiration >= 0 &&
    certificate.daysUntilExpiration <= 30;
  const transparencyOnly = certificate?.observationKind === "certificate-transparency";
  return {
    stage: {
      id: prefix,
      type: "tls",
      title: `Certificate for ${result.hostname}`,
      shortTitle: `TLS · ${result.hostname}`,
      description: result.error
        ? result.certificate
          ? "The direct peer probe was unavailable, so bounded Certificate Transparency issuance evidence is shown instead."
          : `${result.error.message} This does not prove the website certificate is invalid.`
        : transparencyOnly
          ? "Certificate Transparency issuance evidence is available, but the certificate served to Worker fetch remains unobserved."
          : invalid
            ? "The independently observed certificate has a validity or hostname-coverage problem."
            : "An independent TLS probe observed a currently valid certificate covering this hostname.",
      status:
        invalid && !transparencyOnly
          ? "error"
          : result.error || expiringSoon || transparencyOnly
            ? "warning"
            : "success",
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      durationMs: result.durationMs,
      evidence: stageEvidence,
      connections: [],
      branch: 0,
    },
    findingEvidence: {
      result,
      ...(certificateId ? { certificateId } : {}),
      ...(validityId ? { validityId } : {}),
      ...(coverageId ? { coverageId } : {}),
      limitationsId,
      ...(errorId ? { errorId } : {}),
    },
  };
}

export function adaptHttpDiagnosticToInvestigation(
  diagnostic: HttpDiagnosticResult,
  options: InvestigationAdapterOptions = {},
): Investigation {
  const stages: JourneyStage[] = [];
  const network = options.network;
  const dnsFindingEvidence: DnsFindingEvidence[] = [];
  const certificateFindingEvidence: CertificateFindingEvidence[] = [];
  let browserFindingEvidence: BrowserFindingEvidence | undefined;
  let browserBranches: JourneyStage[] = [];
  const dnsEntries =
    network?.dns.map((result, index) => ({ result, ...dnsStage(result, index) })) ?? [];
  const certificateEntries =
    network?.certificates.map((result, index) => ({
      result,
      ...certificateStage(result, index),
    })) ?? [];
  const appendedDns = new Set<string>();
  const appendedCertificates = new Set<string>();
  const appendHostStages = (hostname: string, protocol: string) => {
    const normalizedHostname = hostname.toLowerCase();
    const dnsEntry = dnsEntries.find((entry) => entry.result.hostname === normalizedHostname);
    if (dnsEntry && !appendedDns.has(normalizedHostname)) {
      stages.push(dnsEntry.stage);
      dnsFindingEvidence.push(dnsEntry.findingEvidence);
      appendedDns.add(normalizedHostname);
    }
    const certificateEntry = certificateEntries.find(
      (entry) => entry.result.hostname === normalizedHostname,
    );
    if (
      protocol === "https:" &&
      certificateEntry &&
      !appendedCertificates.has(normalizedHostname)
    ) {
      stages.push(certificateEntry.stage);
      certificateFindingEvidence.push(certificateEntry.findingEvidence);
      appendedCertificates.add(normalizedHostname);
    }
  };
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
      diagnostic.error?.stage === "dns" ? "incomplete" : "passed",
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

  appendHostStages(host, diagnostic.normalizedUrl.protocol);

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
    if (hop.destinationUrl) {
      const destination = new URL(hop.destinationUrl);
      appendHostStages(destination.hostname, destination.protocol);
    }
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
      type: "origin",
      title: "Worker document response received",
      shortTitle: "Worker response",
      description:
        "The Worker HTTP collector received the document response. Browser evidence, when available, begins in the next stage.",
      status: response.status >= 400 ? "warning" : "success",
      completedAt: response.collectedAt,
      evidence: checks,
      connections: [],
      branch: 0,
    });

    if (network?.browser) {
      const adaptedBrowser = browserStages(network.browser);
      stages.push(...adaptedBrowser.core);
      browserBranches = adaptedBrowser.branches;
      browserFindingEvidence = adaptedBrowser.findingEvidence;
    }
  }

  if (diagnostic.error) {
    stages.push({
      id: "terminal-error",
      type: "error",
      title: `${diagnostic.error.stage === "dns" ? "DNS" : "HTTP"} investigation stopped`,
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
  if (browserBranches.length > 0) {
    const browserStage = stages.find((stage) => stage.id === "browser-investigation");
    if (browserStage) browserStage.connections.push(...browserBranches.map((stage) => stage.id));
    stages.push(...browserBranches);
  }
  const findings = [
    ...createDnsTlsFindings(dnsFindingEvidence, certificateFindingEvidence),
    ...createHttpFindings(diagnostic, cache, security, findingEvidence),
    ...createBrowserFindings(browserFindingEvidence),
  ].sort(
    (left, right) => findingSeverityOrder[left.severity] - findingSeverityOrder[right.severity],
  );
  const contentLength = Number.parseInt(
    diagnostic.finalResponse?.headers["content-length"] ?? "",
    10,
  );
  const investigation: Investigation = {
    id: options.id ?? `http-${crypto.randomUUID()}`,
    title: `${network ? "Network" : "HTTP"} journey for ${host}`,
    summary: diagnostic.error
      ? `The Worker preserved ${network?.dns.length ?? 0} DNS result${network?.dns.length === 1 ? "" : "s"} and ${diagnostic.redirects.length} redirect hop${diagnostic.redirects.length === 1 ? "" : "s"} before the investigation stopped.`
      : `The Worker observed ${network?.dns.length ?? 0} DNS result${network?.dns.length === 1 ? "" : "s"}, ${network?.certificates.length ?? 0} certificate probe${network?.certificates.length === 1 ? "" : "s"}, ${diagnostic.redirects.length} redirect hop${diagnostic.redirects.length === 1 ? "" : "s"}, HTTP ${diagnostic.finalResponse?.status ?? "unknown"}, and ${network?.browser?.status === "success" || network?.browser?.status === "partial" ? "one browser lab session" : "no completed browser session"}.`,
    scenario: "live-http",
    url: diagnostic.normalizedUrl.canonicalUrl,
    normalizedUrl: diagnostic.normalizedUrl.canonicalUrl,
    status: diagnostic.error ? "failed" : "completed",
    createdAt: diagnostic.startedAt,
    completedAt: diagnostic.completedAt,
    stages,
    findings,
    metrics: {
      totalDurationMs: network?.totalDurationMs ?? diagnostic.totalDurationMs,
      ...(network
        ? {
            dnsMs: network.dns.reduce((total, result) => total + result.durationMs, 0),
            tlsMs: network.certificates.reduce((total, result) => total + result.durationMs, 0),
          }
        : {}),
      requestCount: diagnostic.redirects.length + (diagnostic.finalResponse ? 1 : 0),
      ...(network?.browser
        ? {
            browserDurationMs: network.browser.durationMs,
            requestCount: network.browser.resourceSummary.totalObserved,
            thirdPartyCount: network.browser.resourceSummary.thirdPartyCount,
            ...(network.browser.navigation.firstContentfulPaintMs === undefined
              ? {}
              : { firstContentfulPaintMs: network.browser.navigation.firstContentfulPaintMs }),
            ...(network.browser.navigation.domContentLoadedMs === undefined
              ? {}
              : { domContentLoadedMs: network.browser.navigation.domContentLoadedMs }),
            ...(network.browser.navigation.loadEventMs === undefined
              ? {}
              : { loadEventMs: network.browser.navigation.loadEventMs }),
            ...(network.browser.navigation.largestContentfulPaintMs === undefined
              ? {}
              : { largestContentfulPaintMs: network.browser.navigation.largestContentfulPaintMs }),
            ...(network.browser.resourceSummary.totalTransferBytes === undefined
              ? {}
              : { transferredBytes: network.browser.resourceSummary.totalTransferBytes }),
          }
        : {}),
      ...(network?.browser?.resourceSummary.totalTransferBytes === undefined &&
      Number.isFinite(contentLength) &&
      contentLength >= 0
        ? { transferredBytes: contentLength }
        : {}),
    },
    artifacts: network?.browser?.artifact ? [network.browser.artifact] : [],
    mock: false,
  };

  return investigationSchema.parse(investigation);
}

export function adaptNetworkDiagnosticToInvestigation(
  diagnostic: NetworkDiagnosticResult,
  options: Omit<InvestigationAdapterOptions, "network"> = {},
): Investigation {
  return adaptHttpDiagnosticToInvestigation(diagnostic.http, { ...options, network: diagnostic });
}
