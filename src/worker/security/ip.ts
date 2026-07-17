import ipaddr from "ipaddr.js";

export interface IpAssessment {
  address: string;
  version: 4 | 6;
  range: string;
  allowed: boolean;
}

export function isIpAddress(value: string): boolean {
  return ipaddr.isValid(value);
}

export function assessIpAddress(value: string): IpAssessment {
  if (!ipaddr.isValid(value)) throw new Error("Invalid IP address");

  const address = ipaddr.parse(value);
  if (address instanceof ipaddr.IPv6 && address.isIPv4MappedAddress()) {
    const mapped = address.toIPv4Address();
    const range = mapped.range();
    return {
      address: address.toRFC5952String(),
      version: 6,
      range: `ipv4-mapped:${range}`,
      allowed: range === "unicast",
    };
  }

  const range = address.range();
  return {
    address: address.toString(),
    version: address.kind() === "ipv4" ? 4 : 6,
    range,
    allowed: range === "unicast",
  };
}
