import type { AddressResolver } from "./dns";
import { assessIpAddress, isIpAddress } from "./ip";
import type { NormalizedUrl } from "./url";

const INTERNAL_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "instance-data",
]);
const INTERNAL_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".localdomain"];

export type SsrfPolicyCode =
  "internal_hostname" | "blocked_ip_range" | "resolution_failed" | "no_public_address";

export class SsrfPolicyError extends Error {
  readonly code: SsrfPolicyCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: SsrfPolicyCode,
    message: string,
    retryable = false,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SsrfPolicyError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export interface ValidatedDestination extends NormalizedUrl {
  resolvedAddresses: string[];
}

function assertAllowedAddress(address: string): void {
  const assessment = assessIpAddress(address);
  if (!assessment.allowed) {
    throw new SsrfPolicyError(
      "blocked_ip_range",
      "The destination resolves to a network range that cannot be investigated.",
      false,
      { range: assessment.range, version: assessment.version },
    );
  }
}

function assertExternalHostname(hostname: string): void {
  if (
    INTERNAL_HOSTS.has(hostname) ||
    INTERNAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) ||
    !hostname.includes(".")
  ) {
    throw new SsrfPolicyError(
      "internal_hostname",
      "Local and internal hostnames cannot be investigated.",
    );
  }
}

export async function validatePublicDestination(
  normalized: NormalizedUrl,
  resolver: AddressResolver,
  signal?: AbortSignal,
): Promise<ValidatedDestination> {
  if (isIpAddress(normalized.hostname)) {
    assertAllowedAddress(normalized.hostname);
    return { ...normalized, resolvedAddresses: [normalized.hostname] };
  }

  assertExternalHostname(normalized.hostname);

  let addresses: string[];
  try {
    addresses = await resolver.resolve(normalized.hostname, signal);
  } catch (error) {
    if (error instanceof SsrfPolicyError) throw error;
    throw new SsrfPolicyError(
      "resolution_failed",
      "The destination hostname could not be safely resolved.",
      true,
    );
  }

  if (addresses.length === 0) {
    throw new SsrfPolicyError(
      "no_public_address",
      "The destination hostname did not resolve to a public address.",
      true,
    );
  }
  for (const address of addresses) assertAllowedAddress(address);
  return { ...normalized, resolvedAddresses: [...new Set(addresses)] };
}
