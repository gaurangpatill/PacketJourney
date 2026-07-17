import type { AllowedHeaders } from "./types";

export interface InfrastructureClue {
  id: string;
  label: string;
  value: string | number;
  sourceHeader: string;
  confidence: "verified" | "inferred";
}

function addHeaderClue(
  clues: InfrastructureClue[],
  headers: AllowedHeaders,
  sourceHeader: string,
  id: string,
  label: string,
  confidence: "verified" | "inferred" = "verified",
): void {
  const value = headers[sourceHeader];
  if (value) clues.push({ id, label, value, sourceHeader, confidence });
}

export function identifyInfrastructureClues(headers: AllowedHeaders): InfrastructureClue[] {
  const clues: InfrastructureClue[] = [];

  if (headers["cf-ray"] || headers["cf-cache-status"]) {
    clues.push({
      id: "cloudflare-edge",
      label: "Cloudflare edge headers observed",
      value: headers["cf-ray"] ?? headers["cf-cache-status"] ?? "present",
      sourceHeader: headers["cf-ray"] ? "cf-ray" : "cf-cache-status",
      confidence: "verified",
    });
  }
  if (headers["x-amz-cf-id"] || headers["x-amz-cf-pop"]) {
    clues.push({
      id: "cloudfront-clue",
      label: "Amazon CloudFront header pattern",
      value: headers["x-amz-cf-pop"] ?? "vendor-specific header present",
      sourceHeader: headers["x-amz-cf-pop"] ? "x-amz-cf-pop" : "x-amz-cf-id",
      confidence: "inferred",
    });
  }
  if (headers["x-served-by"]) {
    clues.push({
      id: "proxy-clue",
      label: "Reverse proxy or CDN path",
      value: headers["x-served-by"],
      sourceHeader: "x-served-by",
      confidence: "inferred",
    });
  } else if (headers.via) {
    clues.push({
      id: "proxy-clue",
      label: "Intermediary Via header",
      value: headers.via,
      sourceHeader: "via",
      confidence: "inferred",
    });
  }

  addHeaderClue(clues, headers, "server", "server-disclosure", "Server header disclosure");
  addHeaderClue(clues, headers, "content-encoding", "compression", "Content encoding");
  addHeaderClue(clues, headers, "content-type", "content-type", "Response content type");

  const contentLength = Number.parseInt(headers["content-length"] ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength >= 0) {
    clues.push({
      id: "content-length",
      label: "Declared response length",
      value: contentLength,
      sourceHeader: "content-length",
      confidence: "verified",
    });
  }
  return clues;
}
