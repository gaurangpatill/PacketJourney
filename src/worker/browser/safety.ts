import type { AddressResolver } from "../security/dns";
import { validatePublicDestination } from "../security/ssrf";
import { normalizeInvestigationUrl } from "../security/url";

const PASSIVE_BROWSER_PROTOCOLS = new Set(["data:", "blob:", "about:"]);

export async function validateBrowserRequest(
  value: string,
  navigationRequest: boolean,
  resolver: AddressResolver,
): Promise<"network" | "passive"> {
  const parsed = new URL(value);
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    await validatePublicDestination(normalizeInvestigationUrl(parsed.toString()), resolver);
    return "network";
  }
  if (!navigationRequest && PASSIVE_BROWSER_PROTOCOLS.has(parsed.protocol)) return "passive";
  throw new Error(`Unsupported browser request protocol: ${parsed.protocol}`);
}
