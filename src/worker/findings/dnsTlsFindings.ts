import type { Finding } from "../../features/investigation/schema";
import type { CertificateDiagnosticResult } from "../diagnostics/certificate";
import type { DnsDiagnosticResult } from "../diagnostics/dns";

export interface DnsFindingEvidence {
  result: DnsDiagnosticResult;
  recordsId: string;
  aliasesId: string;
  addressesId: string;
  dnssecId: string;
  errorId?: string;
}

export interface CertificateFindingEvidence {
  result: CertificateDiagnosticResult;
  certificateId?: string;
  validityId?: string;
  coverageId?: string;
  limitationsId: string;
  errorId?: string;
}

const severityOrder: Record<Finding["severity"], number> = {
  high: 0,
  medium: 1,
  low: 2,
  info: 3,
};

export function createDnsTlsFindings(
  dnsEvidence: DnsFindingEvidence[],
  certificateEvidence: CertificateFindingEvidence[],
): Finding[] {
  const findings: Finding[] = [];

  for (const evidence of dnsEvidence) {
    const { result } = evidence;
    if (result.aliasChain.length >= 3) {
      findings.push({
        id: `dns-long-alias-chain-${result.hostname}`,
        severity: "low",
        category: "dns",
        title: "Long DNS alias chain observed",
        explanation: `${result.hostname} traversed ${result.aliasChain.length} CNAME steps. This adds operational dependencies, but the resolver evidence does not isolate their latency impact.`,
        evidenceIds: [evidence.aliasesId],
        recommendation:
          "Review whether every alias remains necessary and owned by an expected dependency.",
        confidence: 1,
      });
    }
    if (result.error?.code === "cname_loop") {
      findings.push({
        id: `dns-alias-loop-${result.hostname}`,
        severity: "high",
        category: "dns",
        title: "DNS alias loop prevents resolution",
        explanation:
          "The observed CNAME chain returned to an earlier hostname and could not reach an address.",
        evidenceIds: [evidence.aliasesId, ...(evidence.errorId ? [evidence.errorId] : [])],
        recommendation:
          "Correct the CNAME targets so the chain terminates at usable A or AAAA records.",
        confidence: 1,
      });
    }
    if (result.error?.code === "no_usable_address") {
      findings.push({
        id: `dns-no-address-${result.hostname}`,
        severity: "high",
        category: "dns",
        title: "No usable address observed",
        explanation:
          "The resolver evidence did not produce a usable A or AAAA record at the end of the alias chain.",
        evidenceIds: [evidence.addressesId, ...(evidence.errorId ? [evidence.errorId] : [])],
        recommendation: "Verify the terminal hostname has the intended public address records.",
        confidence: 0.98,
      });
    }
    if (result.dnssec.status === "validation-failed") {
      findings.push({
        id: `dnssec-validation-failed-${result.hostname}`,
        severity: "high",
        category: "dns",
        title: "Resolver reported DNSSEC validation failure",
        explanation:
          "Cloudflare's resolver reported a DNSSEC-related validation failure. This statement is limited to the captured resolver response.",
        evidenceIds: [evidence.dnssecId],
        recommendation:
          "Inspect the domain's DS, DNSKEY, and signed-record chain with an authoritative DNSSEC tool.",
        confidence: 0.95,
      });
    }

    const ttls = result.records
      .map((record) => record.ttl)
      .filter((ttl): ttl is number => ttl !== null);
    if (ttls.some((ttl) => ttl <= 60)) {
      findings.push({
        id: `dns-short-ttl-${result.hostname}`,
        severity: "info",
        category: "dns",
        title: "Very short DNS TTL observed",
        explanation:
          "At least one journey-relevant record can expire from resolver caches within 60 seconds. This may be intentional for rapid changes.",
        evidenceIds: [evidence.recordsId],
        confidence: 1,
      });
    }
    if (!result.addresses.some((address) => address.recordType === "AAAA")) {
      findings.push({
        id: `dns-no-ipv6-${result.hostname}`,
        severity: "info",
        category: "dns",
        title: "No IPv6 address observed",
        explanation:
          "The captured resolver response did not include a usable AAAA record. IPv6 absence is informational, not automatically a defect.",
        evidenceIds: [evidence.addressesId],
        confidence: 1,
      });
    }
  }

  for (const evidence of certificateEvidence) {
    const { result } = evidence;
    if (!result.certificate) {
      findings.push({
        id: `tls-inspection-unavailable-${result.hostname}`,
        severity: "info",
        category: "tls",
        title: "Independent certificate inspection unavailable",
        explanation:
          "The bounded certificate probe did not complete. This does not show that the website certificate is invalid, especially if the separate HTTP fetch succeeded.",
        evidenceIds: [evidence.errorId ?? evidence.limitationsId],
        recommendation:
          "Retry the investigation or verify the certificate with a separate client from another network location.",
        confidence: 1,
      });
      continue;
    }

    const certificate = result.certificate;
    if (certificate.validityStatus === "expired") {
      findings.push({
        id: `tls-expired-${result.hostname}`,
        severity: "high",
        category: "tls",
        title: "Observed certificate is expired",
        explanation: `The independently observed certificate validity ended at ${certificate.validUntil ?? "an unavailable time"}.`,
        evidenceIds: [evidence.validityId ?? evidence.certificateId!],
        recommendation: "Replace or renew the certificate and verify the served chain.",
        confidence: 1,
      });
    } else if (certificate.validityStatus === "not-yet-valid") {
      findings.push({
        id: `tls-not-yet-valid-${result.hostname}`,
        severity: "high",
        category: "tls",
        title: "Observed certificate is not yet valid",
        explanation: `The independently observed certificate validity begins at ${certificate.validFrom ?? "an unavailable time"}.`,
        evidenceIds: [evidence.validityId ?? evidence.certificateId!],
        recommendation:
          "Check issuance timing and system clocks, then serve a certificate valid for the current time.",
        confidence: 1,
      });
    } else if (
      certificate.daysUntilExpiration !== null &&
      certificate.daysUntilExpiration >= 0 &&
      certificate.daysUntilExpiration <= 30
    ) {
      findings.push({
        id: `tls-expiring-${result.hostname}`,
        severity: certificate.daysUntilExpiration <= 14 ? "medium" : "low",
        category: "tls",
        title: "Certificate expires soon",
        explanation: `The independently observed certificate expires in approximately ${certificate.daysUntilExpiration} days.`,
        evidenceIds: [evidence.validityId ?? evidence.certificateId!],
        recommendation: "Confirm automated renewal and deployment are operating before expiration.",
        confidence: 1,
      });
    }

    if (!certificate.hostnameCoverage.covered) {
      findings.push({
        id: `tls-hostname-mismatch-${result.hostname}`,
        severity: "high",
        category: "tls",
        title: "Observed certificate does not cover the hostname",
        explanation: certificate.hostnameCoverage.explanation,
        evidenceIds: [evidence.coverageId ?? evidence.certificateId!],
        recommendation: "Serve a certificate whose DNS SAN covers the requested hostname.",
        confidence: 1,
      });
    }

    if (certificate.sanValuesTruncated) {
      findings.push({
        id: `tls-large-san-surface-${result.hostname}`,
        severity: "info",
        category: "tls",
        title: "Large certificate hostname surface",
        explanation:
          "The certificate contains more SAN entries than the bounded investigation retains. This is informational and not a vulnerability by itself.",
        evidenceIds: [evidence.certificateId!],
        confidence: 1,
      });
    }
  }

  return findings.sort(
    (left, right) => severityOrder[left.severity] - severityOrder[right.severity],
  );
}
