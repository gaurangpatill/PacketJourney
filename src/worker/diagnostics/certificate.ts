import {
  connect,
  type DetailedPeerCertificate,
  type PeerCertificate,
  type TLSSocket,
} from "node:tls";

export const MAX_SAN_VALUES = 100;
export const MAX_CERTIFICATE_CHAIN_DEPTH = 6;
export const DEFAULT_CERTIFICATE_TIMEOUT_MS = 5_000;

export interface CertificateNameCoverage {
  covered: boolean;
  matchedName?: string;
  matchType: "exact-san" | "wildcard-san" | "exact-common-name" | "wildcard-common-name" | "none";
  explanation: string;
}

export interface CertificateIdentity {
  commonName?: string;
  organization?: string[];
  organizationalUnit?: string[];
  country?: string[];
}

export interface CertificateChainEntry {
  subject: CertificateIdentity;
  issuer: CertificateIdentity;
  serialNumber: string;
  validFrom: string | null;
  validUntil: string | null;
  fingerprint256?: string;
}

export interface CertificateEvidence {
  requestedHostname: string;
  connectionHostname: string;
  connectionAddress: string;
  subject: CertificateIdentity;
  subjectAlternativeNames: string[];
  sanValuesTruncated: boolean;
  issuer: CertificateIdentity;
  serialNumber: string;
  fingerprint256?: string;
  validFrom: string | null;
  validUntil: string | null;
  daysUntilExpiration: number | null;
  validityStatus: "valid" | "expired" | "not-yet-valid" | "unavailable";
  hostnameCoverage: CertificateNameCoverage;
  chain: CertificateChainEntry[];
  chainTruncated: boolean;
  publicKeyAlgorithm: "RSA" | "EC" | "unknown";
  publicKeyBits?: number;
  publicKeyCurve?: string;
  signatureAlgorithm: "unavailable";
  source: "Independent Cloudflare Worker node:tls certificate probe";
  collectedAt: string;
  durationMs: number;
  fetchSessionMetadata: {
    tlsVersion: "unavailable";
    cipherSuite: "unavailable";
    alpn: "unavailable";
    handshakeDurationMs: "unavailable";
    tcpDurationMs: "unavailable";
    explanation: string;
  };
}

export type CertificateDiagnosticErrorCode =
  "probe_timeout" | "probe_connection_failed" | "certificate_unavailable" | "certificate_malformed";

export interface CertificateDiagnosticError {
  code: CertificateDiagnosticErrorCode;
  message: string;
  retryable: boolean;
}

export interface CertificateDiagnosticResult {
  hostname: string;
  connectionAddress: string;
  status: "success" | "warning";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  certificate?: CertificateEvidence;
  error?: CertificateDiagnosticError;
}

export interface CertificateInspector {
  inspect(
    hostname: string,
    connectionAddress: string,
    options?: CertificateInspectionOptions,
  ): Promise<CertificateDiagnosticResult>;
}

export interface CertificateInspectionOptions {
  timeoutMs?: number;
  monotonicNow?: () => number;
  wallClockNow?: () => Date;
}

type TlsConnector = typeof connect;

function hostnameToAscii(hostname: string): string {
  try {
    return new URL(`https://${hostname.replace(/\.$/, "")}`).hostname.toLowerCase();
  } catch {
    return hostname.replace(/\.$/, "").toLowerCase();
  }
}

function matchDnsName(hostname: string, candidate: string): "exact" | "wildcard" | undefined {
  const requested = hostnameToAscii(hostname);
  const normalizedCandidate = hostnameToAscii(candidate);
  if (requested === normalizedCandidate) return "exact";
  if (!normalizedCandidate.startsWith("*.")) return undefined;

  const suffixLabels = normalizedCandidate.slice(2).split(".");
  const requestedLabels = requested.split(".");
  if (requestedLabels.length !== suffixLabels.length + 1) return undefined;
  return requestedLabels.slice(1).join(".") === suffixLabels.join(".") ? "wildcard" : undefined;
}

export function verifyCertificateHostname(
  hostname: string,
  subjectAlternativeNames: string[],
  commonName?: string,
): CertificateNameCoverage {
  for (const san of subjectAlternativeNames) {
    const match = matchDnsName(hostname, san);
    if (match) {
      return {
        covered: true,
        matchedName: san,
        matchType: match === "exact" ? "exact-san" : "wildcard-san",
        explanation:
          match === "exact"
            ? "An exact DNS subject alternative name covers the requested hostname."
            : "A single-label DNS wildcard subject alternative name covers the requested hostname.",
      };
    }
  }

  if (subjectAlternativeNames.length === 0 && commonName) {
    const match = matchDnsName(hostname, commonName);
    if (match) {
      return {
        covered: true,
        matchedName: commonName,
        matchType: match === "exact" ? "exact-common-name" : "wildcard-common-name",
        explanation:
          "No DNS SAN was available, so coverage was evaluated using the legacy subject common name.",
      };
    }
  }

  return {
    covered: false,
    matchType: "none",
    explanation:
      subjectAlternativeNames.length === 0
        ? "No DNS subject alternative name or matching legacy common name covered the requested hostname."
        : "None of the observed DNS subject alternative names covered the requested hostname.",
  };
}

function values(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return (Array.isArray(value) ? value : [value]).slice(0, 16);
}

function identity(certificate: PeerCertificate["subject"] | undefined): CertificateIdentity {
  if (!certificate) return {};
  const commonNames = values(certificate.CN);
  return {
    ...(commonNames?.[0] ? { commonName: commonNames[0] } : {}),
    ...(values(certificate.O) ? { organization: values(certificate.O) } : {}),
    ...(values(certificate.OU) ? { organizationalUnit: values(certificate.OU) } : {}),
    ...(values(certificate.C) ? { country: values(certificate.C) } : {}),
  };
}

function parseSanValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"')) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return typeof parsed === "string" ? parsed : trimmed;
  } catch {
    return trimmed;
  }
}

export function parseDnsSubjectAlternativeNames(subjectAlternativeName?: string): {
  values: string[];
  truncated: boolean;
} {
  if (!subjectAlternativeName) return { values: [], truncated: false };
  const candidates = subjectAlternativeName
    .split(/, (?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .filter((entry) => entry.startsWith("DNS:"))
    .map((entry) => hostnameToAscii(parseSanValue(entry.slice(4))))
    .filter(Boolean);
  return {
    values: [...new Set(candidates)].slice(0, MAX_SAN_VALUES),
    truncated: candidates.length > MAX_SAN_VALUES,
  };
}

function parseCertificateDate(value: string | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function validity(
  validFrom: string | null,
  validUntil: string | null,
  now: Date,
): Pick<CertificateEvidence, "daysUntilExpiration" | "validityStatus"> {
  if (!validFrom || !validUntil) {
    return { daysUntilExpiration: null, validityStatus: "unavailable" };
  }
  const start = Date.parse(validFrom);
  const end = Date.parse(validUntil);
  const daysUntilExpiration = Math.ceil((end - now.getTime()) / 86_400_000);
  if (now.getTime() < start) return { daysUntilExpiration, validityStatus: "not-yet-valid" };
  if (now.getTime() > end) return { daysUntilExpiration, validityStatus: "expired" };
  return { daysUntilExpiration, validityStatus: "valid" };
}

function chainEntries(certificate: DetailedPeerCertificate): {
  entries: CertificateChainEntry[];
  truncated: boolean;
} {
  const entries: CertificateChainEntry[] = [];
  const fingerprints = new Set<string>();
  let current: DetailedPeerCertificate | undefined = certificate;

  while (current && entries.length < MAX_CERTIFICATE_CHAIN_DEPTH) {
    const key = current.fingerprint256 || current.serialNumber;
    if (!key || fingerprints.has(key)) break;
    fingerprints.add(key);
    entries.push({
      subject: identity(current.subject),
      issuer: identity(current.issuer),
      serialNumber: current.serialNumber ?? "unavailable",
      validFrom: parseCertificateDate(current.valid_from),
      validUntil: parseCertificateDate(current.valid_to),
      ...(current.fingerprint256 ? { fingerprint256: current.fingerprint256 } : {}),
    });
    current = current.issuerCertificate;
  }

  return {
    entries,
    truncated: Boolean(current && entries.length >= MAX_CERTIFICATE_CHAIN_DEPTH),
  };
}

export function normalizePeerCertificate(
  hostname: string,
  connectionAddress: string,
  certificate: DetailedPeerCertificate,
  collectedAt: Date,
  durationMs: number,
): CertificateEvidence {
  const sans = parseDnsSubjectAlternativeNames(certificate.subjectaltname);
  const subject = identity(certificate.subject);
  const validFrom = parseCertificateDate(certificate.valid_from);
  const validUntil = parseCertificateDate(certificate.valid_to);
  const chain = chainEntries(certificate);
  const algorithm =
    certificate.modulus || certificate.exponent
      ? "RSA"
      : certificate.asn1Curve || certificate.nistCurve
        ? "EC"
        : "unknown";

  return {
    requestedHostname: hostnameToAscii(hostname),
    connectionHostname: hostnameToAscii(hostname),
    connectionAddress,
    subject,
    subjectAlternativeNames: sans.values,
    sanValuesTruncated: sans.truncated,
    issuer: identity(certificate.issuer),
    serialNumber: certificate.serialNumber ?? "unavailable",
    ...(certificate.fingerprint256 ? { fingerprint256: certificate.fingerprint256 } : {}),
    validFrom,
    validUntil,
    ...validity(validFrom, validUntil, collectedAt),
    hostnameCoverage: verifyCertificateHostname(hostname, sans.values, subject.commonName),
    chain: chain.entries,
    chainTruncated: chain.truncated,
    publicKeyAlgorithm: algorithm,
    ...(certificate.bits ? { publicKeyBits: certificate.bits } : {}),
    ...(certificate.nistCurve || certificate.asn1Curve
      ? { publicKeyCurve: certificate.nistCurve ?? certificate.asn1Curve }
      : {}),
    signatureAlgorithm: "unavailable",
    source: "Independent Cloudflare Worker node:tls certificate probe",
    collectedAt: collectedAt.toISOString(),
    durationMs,
    fetchSessionMetadata: {
      tlsVersion: "unavailable",
      cipherSuite: "unavailable",
      alpn: "unavailable",
      handshakeDurationMs: "unavailable",
      tcpDurationMs: "unavailable",
      explanation:
        "The certificate probe is independent of the Worker fetch. The outbound HTTP fetch session does not expose these fields.",
    },
  };
}

function roundedDuration(start: number, end: number): number {
  return Math.max(0, Math.round((end - start) * 100) / 100);
}

function publicProbeError(error: unknown): CertificateDiagnosticError {
  return {
    code: "probe_connection_failed",
    message:
      error instanceof Error && /certificate|tls|ssl/i.test(error.message)
        ? "The independent certificate probe could not complete its TLS connection."
        : "The independent certificate probe could not reach the validated public address.",
    retryable: true,
  };
}

export class WorkerTlsCertificateInspector implements CertificateInspector {
  constructor(private readonly connector: TlsConnector = connect) {}

  inspect(
    hostname: string,
    connectionAddress: string,
    options: CertificateInspectionOptions = {},
  ): Promise<CertificateDiagnosticResult> {
    const monotonicNow = options.monotonicNow ?? (() => performance.now());
    const wallClockNow = options.wallClockNow ?? (() => new Date());
    const timeoutMs = options.timeoutMs ?? DEFAULT_CERTIFICATE_TIMEOUT_MS;
    const startedTick = monotonicNow();
    const startedAt = wallClockNow().toISOString();

    return new Promise((resolve) => {
      let settled = false;
      let socket: TLSSocket | undefined;
      const finish = (
        fields: Pick<CertificateDiagnosticResult, "status"> &
          Partial<Pick<CertificateDiagnosticResult, "certificate" | "error">>,
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket?.destroy();
        const completedAt = wallClockNow().toISOString();
        resolve({
          hostname: hostnameToAscii(hostname),
          connectionAddress,
          startedAt,
          completedAt,
          durationMs: roundedDuration(startedTick, monotonicNow()),
          ...fields,
        });
      };
      const timeout = setTimeout(() => {
        finish({
          status: "warning",
          error: {
            code: "probe_timeout",
            message: "The independent certificate probe exceeded its timeout.",
            retryable: true,
          },
        });
      }, timeoutMs);

      try {
        socket = this.connector(
          {
            host: connectionAddress,
            port: 443,
            servername: hostnameToAscii(hostname),
            rejectUnauthorized: false,
          },
          () => {
            try {
              const certificate = socket?.getPeerCertificate(true);
              if (!certificate || Object.keys(certificate).length === 0) {
                finish({
                  status: "warning",
                  error: {
                    code: "certificate_unavailable",
                    message: "The TLS peer did not provide certificate details to the probe.",
                    retryable: true,
                  },
                });
                return;
              }
              const collectedAt = wallClockNow();
              const durationMs = roundedDuration(startedTick, monotonicNow());
              finish({
                status: "success",
                certificate: normalizePeerCertificate(
                  hostname,
                  connectionAddress,
                  certificate,
                  collectedAt,
                  durationMs,
                ),
              });
            } catch {
              finish({
                status: "warning",
                error: {
                  code: "certificate_malformed",
                  message: "The certificate probe returned fields that could not be normalized.",
                  retryable: false,
                },
              });
            }
          },
        );
        socket.once("error", (error) =>
          finish({ status: "warning", error: publicProbeError(error) }),
        );
      } catch (error) {
        finish({ status: "warning", error: publicProbeError(error) });
      }
    });
  }
}
