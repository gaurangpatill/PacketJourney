import type { RuntimeLimits } from "../env";
import {
  CachingDnsQueryClient,
  DnsQueryAddressResolver,
  type AddressResolver,
  type DnsQueryClient,
} from "../security/dns";
import { assessIpAddress, isIpAddress } from "../security/ip";
import { SsrfPolicyError, validatePublicDestination } from "../security/ssrf";
import { normalizeInvestigationUrl, type NormalizedUrl } from "../security/url";
import type { CertificateInspector } from "./certificate";
import { collectDnsDiagnostic, type DnsDiagnosticResult } from "./dns";
import { traceHttpRedirects, type DiagnosticFetch } from "./redirects";
import type { HttpDiagnosticResult, NetworkDiagnosticResult } from "./types";

export interface NetworkInvestigationDependencies {
  dnsClient: DnsQueryClient;
  certificateInspector: CertificateInspector;
  resolver?: AddressResolver;
  fetcher?: DiagnosticFetch;
  monotonicNow?: () => number;
  wallClockNow?: () => Date;
}

interface HostTarget {
  hostname: string;
  protocol: "http:" | "https:";
}

function roundedDuration(start: number, end: number): number {
  return Math.max(0, Math.round((end - start) * 100) / 100);
}

function literalDnsDiagnostic(
  hostname: string,
  startedAt: string,
  completedAt: string,
): DnsDiagnosticResult {
  const assessment = assessIpAddress(hostname);
  return {
    hostname,
    status: assessment.allowed ? "success" : "error",
    records: [
      {
        queriedHostname: hostname,
        owner: hostname,
        type: assessment.version === 4 ? "A" : "AAAA",
        value: hostname,
        normalizedValue: assessment.address,
        ttl: null,
        source: "Canonical URL IP literal",
        collectedAt: completedAt,
        directlyObserved: true,
      },
    ],
    aliasChain: [],
    terminalHostname: hostname,
    addresses: [
      {
        hostname,
        recordType: assessment.version === 4 ? "A" : "AAAA",
        ttl: null,
        assessment,
      },
    ],
    queries: [],
    dnssec: {
      status: "unavailable",
      explanation: "DNSSEC does not apply because the submitted URL uses an IP literal.",
      authenticatedDataSignals: [],
      comments: [],
      source: "Canonical URL parser",
    },
    startedAt,
    completedAt,
    durationMs: 0,
    ...(assessment.allowed
      ? {}
      : {
          error: {
            code: "mixed_prohibited_addresses" as const,
            message: "The submitted IP literal is prohibited by the public-network safety policy.",
            retryable: false,
          },
        }),
  };
}

function stoppedAtDns(
  input: string,
  normalizedUrl: NormalizedUrl,
  dns: DnsDiagnosticResult,
): HttpDiagnosticResult {
  return {
    requestedUrl: input,
    normalizedUrl,
    redirects: [],
    startedAt: dns.startedAt,
    completedAt: dns.completedAt,
    totalDurationMs: dns.durationMs,
    error: {
      code: "dns_resolution_failed",
      message: dns.error?.message ?? "DNS resolution did not produce a usable public destination.",
      stage: "dns",
      retryable: dns.error?.retryable ?? true,
      details: dns.error ? { diagnosticCode: dns.error.code } : undefined,
    },
  };
}

function targetFromUrl(url: string): HostTarget | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return { hostname: parsed.hostname.toLowerCase(), protocol: parsed.protocol };
  } catch {
    return undefined;
  }
}

function relevantTargets(http: HttpDiagnosticResult, initial: HostTarget): HostTarget[] {
  const candidates = [
    initial,
    ...http.redirects.flatMap((hop) => {
      const target = hop.destinationUrl ? targetFromUrl(hop.destinationUrl) : undefined;
      return target ? [target] : [];
    }),
    ...(http.finalResponse ? [targetFromUrl(http.finalResponse.url)] : []),
  ].filter((target): target is HostTarget => Boolean(target));
  const seen = new Set<string>();
  return candidates.filter((target) => {
    const key = `${target.hostname}|${target.protocol}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function withDnsTimeout(
  hostname: string,
  client: DnsQueryClient,
  timeoutMs: number,
  includeDetailRecords: boolean,
): Promise<DnsDiagnosticResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await collectDnsDiagnostic(hostname, client, {
      includeDetailRecords,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function investigateNetworkJourney(
  input: string,
  limits: RuntimeLimits,
  dependencies: NetworkInvestigationDependencies,
): Promise<NetworkDiagnosticResult> {
  const monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
  const wallClockNow = dependencies.wallClockNow ?? (() => new Date());
  const startedTick = monotonicNow();
  const startedAt = wallClockNow().toISOString();
  const normalizedUrl = normalizeInvestigationUrl(input);
  const client = new CachingDnsQueryClient(dependencies.dnsClient);
  const resolver = dependencies.resolver ?? new DnsQueryAddressResolver(client);
  const dns: DnsDiagnosticResult[] = [];
  const certificates: NetworkDiagnosticResult["certificates"] = [];
  const initialTarget: HostTarget = {
    hostname: normalizedUrl.hostname,
    protocol: normalizedUrl.protocol,
  };

  const collectDns = async (target: HostTarget, includeDetails: boolean) => {
    const now = wallClockNow().toISOString();
    const result = isIpAddress(target.hostname)
      ? literalDnsDiagnostic(target.hostname, now, now)
      : await withDnsTimeout(target.hostname, client, limits.dnsTimeoutMs, includeDetails);
    dns.push(result);
    return result;
  };

  const inspectCertificate = async (target: HostTarget, result: DnsDiagnosticResult) => {
    if (
      target.protocol !== "https:" ||
      result.error ||
      certificates.length >= limits.maximumCertificateInspections
    ) {
      return;
    }
    const address = result.addresses.find((item) => item.assessment.allowed)?.assessment.address;
    if (!address) return;
    certificates.push(
      await dependencies.certificateInspector.inspect(target.hostname, address, {
        timeoutMs: limits.certificateTimeoutMs,
      }),
    );
  };

  const initialDns = await collectDns(initialTarget, true);
  if (initialDns.error) {
    if (initialDns.error.code === "mixed_prohibited_addresses") {
      throw new SsrfPolicyError("blocked_ip_range", initialDns.error.message, false, {
        hostname: initialTarget.hostname,
      });
    }
    const http = stoppedAtDns(input, normalizedUrl, initialDns);
    return {
      http,
      dns,
      certificates,
      startedAt,
      completedAt: http.completedAt,
      totalDurationMs: roundedDuration(startedTick, monotonicNow()),
    };
  }

  await validatePublicDestination(normalizedUrl, resolver);
  await inspectCertificate(initialTarget, initialDns);

  const elapsed = monotonicNow() - startedTick;
  const http = await traceHttpRedirects(
    input,
    {
      hopTimeoutMs: limits.hopTimeoutMs,
      overallTimeoutMs: Math.max(
        250,
        Math.min(limits.overallTimeoutMs, limits.investigationTimeoutMs - elapsed),
      ),
    },
    { resolver, fetcher: dependencies.fetcher },
  );

  const targets = relevantTargets(http, initialTarget).slice(0, limits.maximumDiagnosticHostnames);
  for (const target of targets.slice(1)) {
    if (monotonicNow() - startedTick >= limits.investigationTimeoutMs) break;
    const result =
      dns.find((item) => item.hostname === target.hostname) ?? (await collectDns(target, false));
    await inspectCertificate(target, result);
  }

  const completedAt = wallClockNow().toISOString();
  return {
    http,
    dns,
    certificates,
    startedAt,
    completedAt,
    totalDurationMs: roundedDuration(startedTick, monotonicNow()),
  };
}
