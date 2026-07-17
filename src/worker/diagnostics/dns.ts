import {
  DNS_RECORD_CODES,
  DNS_RECORD_LIMIT,
  type DnsQueryClient,
  type DnsQueryResult,
  type DnsRecordType,
} from "../security/dns";
import { assessIpAddress, isIpAddress, type IpAssessment } from "../security/ip";

export const SUPPORTED_DNS_RECORD_TYPES = [
  "A",
  "AAAA",
  "CNAME",
  "NS",
  "MX",
  "TXT",
  "CAA",
] as const satisfies readonly DnsRecordType[];
export const MAX_CNAME_DEPTH = 8;
export const MAX_TXT_VALUE_LENGTH = 512;

const RECORD_TYPE_BY_CODE = new Map<number, DnsRecordType>(
  Object.entries(DNS_RECORD_CODES).map(([type, code]) => [code, type as DnsRecordType]),
);

export interface DnsRecordEvidence {
  queriedHostname: string;
  owner: string;
  type: DnsRecordType;
  value: string;
  normalizedValue: string;
  ttl: number | null;
  source: string;
  collectedAt: string;
  directlyObserved: true;
}

export interface DnsAliasStep {
  from: string;
  to: string;
  ttl: number | null;
  sourceRecord: DnsRecordEvidence;
}

export interface DnsAddressEvidence {
  hostname: string;
  recordType: "A" | "AAAA";
  ttl: number | null;
  assessment: IpAssessment;
}

export type DnssecStatus = "authenticated" | "validation-failed" | "inconclusive" | "unavailable";

export interface DnssecEvidence {
  status: DnssecStatus;
  explanation: string;
  authenticatedDataSignals: boolean[];
  comments: string[];
  source: string;
}

export type DnsDiagnosticErrorCode =
  | "resolver_error"
  | "no_usable_address"
  | "cname_loop"
  | "maximum_cname_depth"
  | "mixed_prohibited_addresses";

export interface DnsDiagnosticError {
  code: DnsDiagnosticErrorCode;
  message: string;
  retryable: boolean;
}

export interface DnsDiagnosticResult {
  hostname: string;
  status: "success" | "warning" | "error";
  records: DnsRecordEvidence[];
  aliasChain: DnsAliasStep[];
  terminalHostname: string;
  addresses: DnsAddressEvidence[];
  queries: DnsQueryResult[];
  dnssec: DnssecEvidence;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  error?: DnsDiagnosticError;
}

export interface DnsDiagnosticOptions {
  maximumCnameDepth?: number;
  includeDetailRecords?: boolean;
  monotonicNow?: () => number;
  wallClockNow?: () => Date;
}

function normalizeHostname(value: string): string {
  const stripped = value.trim().replace(/\.$/, "").toLowerCase();
  try {
    return new URL(`https://${stripped}`).hostname;
  } catch {
    return stripped;
  }
}

function sanitizeText(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return (code >= 0 && code <= 8) ||
        code === 11 ||
        code === 12 ||
        (code >= 14 && code <= 31) ||
        code === 127
        ? "�"
        : character;
    })
    .join("")
    .slice(0, MAX_TXT_VALUE_LENGTH);
}

function normalizeRecordValue(type: DnsRecordType, value: string): string {
  const sanitized = sanitizeText(value.trim());
  if (type === "CNAME" || type === "NS") return normalizeHostname(sanitized);
  if (type === "A" || type === "AAAA") {
    return isIpAddress(sanitized) ? assessIpAddress(sanitized).address : sanitized;
  }
  if (type === "MX") {
    const [preference, ...hostnameParts] = sanitized.split(/\s+/);
    const hostname = normalizeHostname(hostnameParts.join(" "));
    return hostname ? `${preference ?? "0"} ${hostname}` : sanitized;
  }
  return sanitized.replace(/\s+/g, " ");
}

function recordsFromQuery(query: DnsQueryResult): DnsRecordEvidence[] {
  const records: DnsRecordEvidence[] = [];
  for (const answer of query.response.Answer ?? []) {
    const type = RECORD_TYPE_BY_CODE.get(answer.type);
    if (!type) continue;
    records.push({
      queriedHostname: query.hostname,
      owner: normalizeHostname(answer.name ?? query.hostname),
      type,
      value: sanitizeText(answer.data),
      normalizedValue: normalizeRecordValue(type, answer.data),
      ttl: answer.TTL ?? null,
      source: query.source,
      collectedAt: query.collectedAt,
      directlyObserved: true,
    });
  }
  return records;
}

function uniqueRecords(records: DnsRecordEvidence[]): DnsRecordEvidence[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = `${record.owner}|${record.type}|${record.normalizedValue}|${record.ttl ?? "unknown"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function queryComments(query: DnsQueryResult): string[] {
  if (!query.response.Comment) return [];
  return Array.isArray(query.response.Comment) ? query.response.Comment : [query.response.Comment];
}

export function interpretDnssec(queries: DnsQueryResult[]): DnssecEvidence {
  const journeyQueries = queries.filter((query) =>
    (["CNAME", "A", "AAAA"] as DnsRecordType[]).includes(query.recordType),
  );
  const comments = journeyQueries.flatMap(queryComments).map(sanitizeText);
  const validationFailure = journeyQueries.some(
    (query) =>
      query.response.Status === 2 &&
      queryComments(query).some((comment) => /dnssec|bogus|validation/i.test(comment)),
  );
  const authenticatedDataSignals = journeyQueries
    .map((query) => query.response.AD)
    .filter((value): value is boolean => typeof value === "boolean");
  const source = "Cloudflare 1.1.1.1 resolver response flags";

  if (validationFailure) {
    return {
      status: "validation-failed",
      explanation: "The resolver reported a DNSSEC-related validation failure for a journey query.",
      authenticatedDataSignals,
      comments,
      source,
    };
  }
  if (journeyQueries.length > 0 && journeyQueries.every((query) => query.response.AD === true)) {
    return {
      status: "authenticated",
      explanation: "The resolver marked every journey answer as DNSSEC-authenticated.",
      authenticatedDataSignals,
      comments,
      source,
    };
  }
  if (authenticatedDataSignals.length > 0) {
    return {
      status: "inconclusive",
      explanation:
        "The resolver did not mark every journey answer as authenticated; this alone does not prove a DNSSEC problem.",
      authenticatedDataSignals,
      comments,
      source,
    };
  }
  return {
    status: "unavailable",
    explanation:
      "The resolver response did not provide enough DNSSEC metadata to classify the journey.",
    authenticatedDataSignals,
    comments,
    source,
  };
}

function roundedDuration(start: number, end: number): number {
  return Math.max(0, Math.round((end - start) * 100) / 100);
}

export async function collectDnsDiagnostic(
  hostname: string,
  client: DnsQueryClient,
  options: DnsDiagnosticOptions = {},
): Promise<DnsDiagnosticResult> {
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const wallClockNow = options.wallClockNow ?? (() => new Date());
  const maximumCnameDepth = options.maximumCnameDepth ?? MAX_CNAME_DEPTH;
  const startedTick = monotonicNow();
  const startedAt = wallClockNow().toISOString();
  const normalizedHostname = normalizeHostname(hostname);
  const queries: DnsQueryResult[] = [];
  const records: DnsRecordEvidence[] = [];
  const aliasChain: DnsAliasStep[] = [];
  const visited = new Set([normalizedHostname]);
  let current = normalizedHostname;
  let error: DnsDiagnosticError | undefined;

  const runQuery = async (name: string, type: DnsRecordType): Promise<DnsQueryResult> => {
    const result = await client.query(name, type);
    queries.push(result);
    records.push(...recordsFromQuery(result));
    return result;
  };

  try {
    while (aliasChain.length < maximumCnameDepth) {
      const cnameQuery = await runQuery(current, "CNAME");
      const cname = recordsFromQuery(cnameQuery).find(
        (record) => record.type === "CNAME" && record.owner === current,
      );
      if (!cname) break;
      const destination = cname.normalizedValue;
      aliasChain.push({ from: current, to: destination, ttl: cname.ttl, sourceRecord: cname });
      if (visited.has(destination)) {
        error = {
          code: "cname_loop",
          message: "The DNS alias chain returned to a hostname that was already visited.",
          retryable: false,
        };
        current = destination;
        break;
      }
      visited.add(destination);
      current = destination;
    }

    if (!error && aliasChain.length >= maximumCnameDepth) {
      const next = await runQuery(current, "CNAME");
      if (recordsFromQuery(next).some((record) => record.type === "CNAME")) {
        error = {
          code: "maximum_cname_depth",
          message: `The DNS alias chain exceeded the ${maximumCnameDepth}-step safety limit.`,
          retryable: false,
        };
      }
    }

    if (!error) {
      await runQuery(current, "A");
      await runQuery(current, "AAAA");
    }

    if (options.includeDetailRecords !== false) {
      for (const type of ["CAA", "NS", "MX", "TXT"] as const) {
        try {
          await runQuery(normalizedHostname, type);
        } catch {
          // Low-priority detail records never discard journey-critical DNS evidence.
        }
      }
    }
  } catch (caught) {
    error = {
      code: "resolver_error",
      message: caught instanceof Error ? caught.message : "The DNS resolver query failed.",
      retryable: true,
    };
  }

  const deduplicatedRecords = uniqueRecords(records).slice(0, DNS_RECORD_LIMIT);
  const addresses = deduplicatedRecords
    .filter(
      (record): record is DnsRecordEvidence & { type: "A" | "AAAA" } =>
        (record.type === "A" || record.type === "AAAA") && isIpAddress(record.normalizedValue),
    )
    .map((record) => ({
      hostname: record.owner,
      recordType: record.type,
      ttl: record.ttl,
      assessment: assessIpAddress(record.normalizedValue),
    }));

  if (!error && addresses.length === 0) {
    error = {
      code: "no_usable_address",
      message: "No usable A or AAAA address was observed at the end of the DNS alias chain.",
      retryable: true,
    };
  } else if (!error && addresses.some((address) => !address.assessment.allowed)) {
    error = {
      code: "mixed_prohibited_addresses",
      message:
        "The DNS response included an address prohibited by the public-network safety policy.",
      retryable: false,
    };
  }

  const completedAt = wallClockNow().toISOString();
  return {
    hostname: normalizedHostname,
    status: error
      ? "error"
      : interpretDnssec(queries).status === "inconclusive"
        ? "warning"
        : "success",
    records: deduplicatedRecords,
    aliasChain,
    terminalHostname: current,
    addresses,
    queries,
    dnssec: interpretDnssec(queries),
    startedAt,
    completedAt,
    durationMs: roundedDuration(startedTick, monotonicNow()),
    ...(error ? { error } : {}),
  };
}
