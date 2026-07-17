import { describe, expect, it } from "vitest";
import { investigationById } from "../../data/investigations";
import type { Investigation, JourneyStage } from "../investigation/schema";
import { buildInvestigationGraph } from "./graph";
import { layoutInvestigationGraph } from "./layout";

const getInvestigation = (id: string) => investigationById.get(id)!;

describe("buildInvestigationGraph", () => {
  it("keeps origin out of the fast cache-hit graph", () => {
    const graph = buildInvestigationGraph(getInvestigation("fast-cached"));
    expect(graph.nodes.map((node) => node.stage.type)).not.toContain("origin");
    expect(graph.primaryNodeIds).toEqual(["input", "dns", "tls", "edge", "cache", "browser"]);
  });

  it("classifies redirect edges and preserves every hop", () => {
    const graph = buildInvestigationGraph(getInvestigation("redirect-chain"));
    const redirects = graph.edges.filter((edge) => edge.relationship === "redirect");
    expect(redirects).toHaveLength(3);
    expect(redirects.map((edge) => edge.label)).toEqual([
      "301 redirect",
      "302 redirect",
      "302 redirect",
    ]);
  });

  it("terminates the TLS failure without later successful stages", () => {
    const graph = buildInvestigationGraph(getInvestigation("tls-warning"));
    expect(graph.terminalIds).toEqual(["tls"]);
    expect(graph.nodes.at(-1)?.stage.status).toBe("error");
  });

  it("marks the measured slow origin as the bottleneck", () => {
    const graph = buildInvestigationGraph(getInvestigation("slow-origin"));
    expect(graph.bottleneckId).toBe("origin");
    expect(graph.nodes.find((node) => node.id === "origin")?.isBottleneck).toBe(true);
    expect(graph.primaryNodeIds).toEqual([
      "input",
      "dns",
      "tls",
      "edge",
      "cache",
      "origin",
      "edge-return",
      "browser",
    ]);
    expect(graph.edges.find((edge) => edge.id === "origin::edge-return")?.relationship).toBe(
      "return",
    );
  });

  it("associates the missing-cache warning and finding with the cache stage", () => {
    const graph = buildInvestigationGraph(getInvestigation("missing-cache"));
    const cache = graph.nodes.find((node) => node.id === "cache");
    expect(cache?.stage.status).toBe("warning");
    expect(cache?.relatedFindings.map((finding) => finding.id)).toContain("cache-f1");
    expect(graph.edges.find((edge) => edge.id === "origin::edge-return")?.relationship).toBe(
      "return",
    );
  });

  it("creates secondary inferred and resource branches", () => {
    const graph = buildInvestigationGraph(getInvestigation("third-party-heavy"));
    expect(graph.nodes.filter((node) => node.path === "secondary").length).toBeGreaterThanOrEqual(
      6,
    );
    expect(graph.edges.some((edge) => edge.relationship === "inferred")).toBe(true);
    expect(graph.edges.some((edge) => edge.relationship === "resource")).toBe(true);
  });

  it("keeps browser completion primary while resource groups branch secondarily", () => {
    const template = getInvestigation("fast-cached").stages[0]!;
    const stages: JourneyStage[] = [
      { ...template, id: "input", type: "input", connections: ["browser"] },
      {
        ...template,
        id: "browser",
        type: "browser",
        connections: ["browser-complete", "scripts", "analytics"],
      },
      {
        ...template,
        id: "browser-complete",
        type: "browser",
        connections: [],
      },
      { ...template, id: "scripts", type: "resource", branch: 1, connections: [] },
      { ...template, id: "analytics", type: "third-party", branch: 2, connections: [] },
    ];
    const graph = buildInvestigationGraph({
      stages,
      findings: [],
      metrics: { totalDurationMs: 100 },
    });

    expect(graph.primaryNodeIds).toEqual(["input", "browser", "browser-complete"]);
    expect(graph.nodes.find((node) => node.id === "scripts")?.path).toBe("secondary");
    expect(graph.edges.find((edge) => edge.targetId === "scripts")?.relationship).toBe("resource");
    expect(graph.edges.find((edge) => edge.targetId === "analytics")?.relationship).toBe(
      "inferred",
    );
  });

  it("ignores malformed connections and duplicate stage IDs defensively", () => {
    const baseStage = getInvestigation("fast-cached").stages[0]!;
    const source = {
      stages: [
        { ...baseStage, id: "one", connections: ["missing"] },
        { ...baseStage, id: "one", connections: [] },
      ],
      findings: [],
      metrics: { totalDurationMs: 0 },
    } satisfies Pick<Investigation, "stages" | "findings" | "metrics">;
    const graph = buildInvestigationGraph(source);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toHaveLength(0);
  });

  it("returns a safe empty graph", () => {
    const graph = buildInvestigationGraph({
      stages: [],
      findings: [],
      metrics: { totalDurationMs: 0 },
    });
    expect(graph).toMatchObject({ nodes: [], edges: [], rootIds: [], terminalIds: [] });
  });
});

describe("layoutInvestigationGraph", () => {
  it("is stable and produces no overlapping nodes", () => {
    const graph = buildInvestigationGraph(getInvestigation("third-party-heavy"));
    const first = layoutInvestigationGraph(graph);
    const second = layoutInvestigationGraph(graph);
    expect(second).toEqual(first);

    for (const node of first.nodes) {
      for (const other of first.nodes) {
        if (node.id === other.id) continue;
        const overlaps =
          node.x < other.x + other.width &&
          node.x + node.width > other.x &&
          node.y < other.y + other.height &&
          node.y + node.height > other.y;
        expect(overlaps).toBe(false);
      }
    }
  });

  it("handles a synthetic 50-node, 100-edge journey", () => {
    const template = getInvestigation("fast-cached").stages[0]!;
    const stages: JourneyStage[] = Array.from({ length: 50 }, (_, index) => ({
      ...template,
      id: `n${index}`,
      title: `Node ${index}`,
      branch: index % 5,
      evidence: [],
      connections: [index + 1, index + 2]
        .filter((target) => target < 50)
        .map((target) => `n${target}`),
    }));
    // Add two stable fan-out connections to reach exactly 100 edges.
    stages[0] = { ...stages[0]!, connections: [...stages[0]!.connections, "n3", "n4", "n5"] };
    const graph = buildInvestigationGraph({
      stages,
      findings: [],
      metrics: { totalDurationMs: 1000 },
    });
    const layout = layoutInvestigationGraph(graph);
    expect(graph.nodes).toHaveLength(50);
    expect(graph.edges).toHaveLength(100);
    expect(layout.nodes).toHaveLength(50);
    expect(layout.width).toBeGreaterThan(1000);
  });
});
