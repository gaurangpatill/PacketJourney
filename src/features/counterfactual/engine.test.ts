import { describe, expect, it } from "vitest";
import { investigations } from "../../data/investigations";
import { investigationSchema, type Investigation } from "../investigation/schema";
import { runCounterfactual } from "./engine";
import { counterfactualResultSchema, type CounterfactualScenario } from "./schemas";

const createdAt = "2026-07-17T12:00:00.000Z";
const base = {
  id: "scenario-test",
  title: "Test scenario",
  description: "A deterministic test scenario.",
  createdAt,
  source: "user" as const,
};
const byId = (id: string) => investigations.find((item) => item.id === id)!;

type ScenarioBody<T = CounterfactualScenario> = T extends CounterfactualScenario
  ? Omit<T, keyof typeof base>
  : never;

function run(source: Investigation, scenario: ScenarioBody) {
  return runCounterfactual(source, { ...base, ...scenario });
}

function browserFixture(): Investigation {
  const source = structuredClone(byId("third-party-heavy"));
  const browser = source.stages.find((stage) => stage.id === "browser")!;
  browser.evidence.push({
    id: "browser-resources-test",
    label: "Browser resources",
    value: [
      {
        id: "script-ok",
        type: "script",
        hostname: "example.com",
        firstParty: true,
        transferSize: 100_000,
        failed: false,
      },
      {
        id: "script-failed",
        type: "script",
        hostname: "cdn.example.com",
        firstParty: true,
        transferSize: 0,
        status: 500,
        failed: true,
        failureReason: "HTTP 500",
      },
      {
        id: "image-external",
        type: "image",
        hostname: "images.example.net",
        firstParty: false,
        transferSize: 20_000,
        failed: false,
      },
    ],
    source: "Recorded browser fixture",
    collectedAt: createdAt,
    confidence: "verified",
  });
  source.findings.push({
    id: "finding-browser-failed-critical-resource",
    severity: "high",
    category: "frontend",
    title: "Critical resource failed",
    explanation: "A critical script failed.",
    evidenceIds: ["browser-resources-test"],
    confidence: 1,
  });
  source.metrics.transferredBytes = 500_000;
  return investigationSchema.parse(source);
}

describe("deterministic counterfactual engine", () => {
  it("removes verified redirects without mutating observed evidence", () => {
    const source = byId("redirect-chain");
    const snapshot = JSON.stringify(source);
    const result = run(source, { type: "remove-redirects", targetStageIds: ["r1", "r2", "r3"] });
    expect(result.simulated.stages.some((stage) => stage.type === "redirect")).toBe(false);
    expect(result.simulated.metrics.totalDurationMs).toBe(source.metrics.totalDurationMs - 313);
    expect(JSON.stringify(source)).toBe(snapshot);
    expect(counterfactualResultSchema.safeParse(result).success).toBe(true);
  });

  it("bypasses origin for an edge-cache hit and keeps paint unavailable", () => {
    const result = run(byId("missing-cache"), {
      type: "enable-edge-cache",
      targetCacheStageId: "cache",
      targetOriginStageId: "origin",
    });
    expect(result.simulated.stages.find((stage) => stage.id === "origin")?.simulation?.state).toBe(
      "unreachable",
    );
    expect(
      result.metricDecisions.find((metric) => metric.metric === "firstContentfulPaintMs")?.policy,
    ).toBe("unavailable");
    expect(result.resolvedFindingIds).toContain("cache-f1");
  });

  it("reduces only the selected origin duration", () => {
    const source = byId("slow-origin");
    const observedOrigin = source.stages.find((stage) => stage.id === "origin")!.durationMs!;
    const result = run(source, {
      type: "reduce-origin-latency",
      targetStageId: "origin",
      targetDurationMs: 100,
    });
    expect(result.simulated.stages.find((stage) => stage.id === "origin")?.durationMs).toBe(100);
    expect(result.simulated.metrics.totalDurationMs).toBe(
      source.metrics.totalDurationMs - (observedOrigin - 100),
    );
  });

  it("reduces known JavaScript transfer without inventing paint timing", () => {
    const source = browserFixture();
    const result = run(source, {
      type: "reduce-javascript",
      targetStageId: "browser",
      reductionPercent: 50,
    });
    const metric = result.metricDecisions.find((item) => item.metric === "transferredBytes");
    expect(metric?.simulatedValue).toBe(450_000);
    expect(result.unavailableMetrics).toContain("largestContentfulPaintMs");
  });

  it("removes one existing third-party branch", () => {
    const source = byId("third-party-heavy");
    const result = run(source, { type: "remove-third-party", targetStageId: "ads" });
    expect(result.simulated.stages.some((stage) => stage.id === "ads")).toBe(false);
    expect(result.changes).toContainEqual(
      expect.objectContaining({ targetId: "ads", operation: "removed" }),
    );
  });

  it("resolves a verified critical resource but keeps unknown response values absent", () => {
    const result = run(browserFixture(), {
      type: "resolve-critical-resource",
      targetResourceId: "script-failed",
    });
    const browserEvidence = result.simulated.stages
      .find((stage) => stage.id === "browser")
      ?.evidence.find((item) => item.id === "browser-resources-test");
    const resource = (browserEvidence?.value as Array<Record<string, unknown>>).find(
      (item) => item.id === "script-failed",
    );
    expect(resource).toMatchObject({ failed: false, simulatedSuccess: true });
    expect(resource).not.toHaveProperty("status");
    expect(resource).not.toHaveProperty("transferSize");
  });

  it("terminates an expired-certificate scenario at TLS", () => {
    const result = run(byId("fast-cached"), { type: "expire-certificate", targetStageId: "tls" });
    expect(result.simulated.stages.find((stage) => stage.id === "tls")?.status).toBe("error");
    expect(result.simulated.stages.find((stage) => stage.id === "edge")?.simulation?.state).toBe(
      "unreachable",
    );
    expect(result.simulatedFindings[0]?.severity).toBe("high");
  });

  it("terminates a no-address scenario at DNS", () => {
    const result = run(byId("fast-cached"), { type: "remove-dns-address", targetStageId: "dns" });
    expect(result.simulated.stages.find((stage) => stage.id === "dns")?.status).toBe("error");
    expect(result.simulated.stages.find((stage) => stage.id === "tls")?.simulation?.state).toBe(
      "unreachable",
    );
  });

  it("is stable for identical source and scenario inputs", () => {
    const scenario = {
      ...base,
      type: "reduce-origin-latency" as const,
      targetStageId: "origin",
      targetDurationMs: 200,
    };
    expect(runCounterfactual(byId("slow-origin"), scenario)).toEqual(
      runCounterfactual(byId("slow-origin"), scenario),
    );
  });

  it("rejects simulated investigations as observed sources", () => {
    const first = run(byId("fast-cached"), { type: "expire-certificate", targetStageId: "tls" });
    expect(() =>
      run(first.simulated, { type: "remove-dns-address", targetStageId: "dns" }),
    ).toThrow(/cannot be used/);
  });
});
