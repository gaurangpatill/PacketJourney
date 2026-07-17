import { describe, expect, it } from "vitest";
import type { EvidenceItem } from "../investigation/schema";
import { visibleEvidenceItems } from "./presentation";

const collectedAt = "2026-07-16T12:00:00.000Z";
const evidence: EvidenceItem[] = [
  {
    id: "summary",
    label: "DNS summary",
    value: "The domain points to two public Internet addresses.",
    source: "Deterministic summary",
    collectedAt,
    confidence: "inferred",
  },
  {
    id: "records",
    label: "Normalized DNS records",
    value: [{ type: "A", value: "93.184.216.34", ttl: 300 }],
    source: "Resolver",
    collectedAt,
    confidence: "verified",
  },
  {
    id: "metadata",
    label: "Resolver query metadata",
    value: { authenticatedData: true },
    source: "Resolver",
    collectedAt,
    confidence: "verified",
  },
];

describe("visibleEvidenceItems", () => {
  it("keeps the evidence model unchanged while varying presentation depth", () => {
    expect(visibleEvidenceItems(evidence, "beginner").map((item) => item.id)).toEqual(["summary"]);
    expect(visibleEvidenceItems(evidence, "developer").map((item) => item.id)).toEqual([
      "summary",
      "records",
    ]);
    expect(visibleEvidenceItems(evidence, "engineer")).toEqual(evidence);
    expect(evidence).toHaveLength(3);
  });
});
