import type { EvidenceItem, Investigation, JourneyStage } from "../investigation/schema";

export type NormalizedResource = {
  id: string;
  type: string;
  hostname?: string;
  firstParty?: boolean;
  failed?: boolean;
  transferSize?: number;
  status?: number;
  renderBlockingCandidate?: boolean;
  failureReason?: string;
  [key: string]: unknown;
};

function resource(value: unknown): NormalizedResource | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.type !== "string") return undefined;
  return {
    ...item,
    id: item.id,
    type: item.type,
    ...(typeof item.hostname === "string" ? { hostname: item.hostname } : {}),
    ...(typeof item.firstParty === "boolean" ? { firstParty: item.firstParty } : {}),
    ...(typeof item.failed === "boolean" ? { failed: item.failed } : {}),
    ...(typeof item.transferSize === "number" ? { transferSize: item.transferSize } : {}),
    ...(typeof item.status === "number" ? { status: item.status } : {}),
    ...(typeof item.renderBlockingCandidate === "boolean"
      ? { renderBlockingCandidate: item.renderBlockingCandidate }
      : {}),
    ...(typeof item.failureReason === "string" ? { failureReason: item.failureReason } : {}),
  };
}

export function resourceEvidence(investigation: Investigation): Array<{
  stage: JourneyStage;
  evidence: EvidenceItem;
  resources: NormalizedResource[];
}> {
  return investigation.stages.flatMap((stage) =>
    stage.evidence.flatMap((evidence) => {
      if (
        !/browser resources|grouped resources/i.test(evidence.label) ||
        !Array.isArray(evidence.value)
      ) {
        return [];
      }
      return [
        { stage, evidence, resources: evidence.value.flatMap((item) => resource(item) ?? []) },
      ];
    }),
  );
}

export function parseByteText(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(b|kb|kib|mb|mib)$/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  const multiplier =
    unit === "mb" || unit === "mib" ? 1_000_000 : unit === "kb" || unit === "kib" ? 1_000 : 1;
  return Math.round(amount * multiplier);
}

export function byteText(bytes: number): string {
  return bytes >= 1_000_000
    ? `${Math.round((bytes / 1_000_000) * 100) / 100} MB`
    : `${Math.round(bytes / 1_000)} KB`;
}

export function resourceSummaryEvidence(investigation: Investigation) {
  return investigation.stages
    .flatMap((stage) => stage.evidence.map((evidence) => ({ stage, evidence })))
    .find(({ evidence }) => evidence.label === "Browser resource summary");
}
