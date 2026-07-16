import type { GraphEdge, GraphNode, InvestigationGraph } from "./graph";

export type PositionedGraphNode = GraphNode & {
  x: number;
  y: number;
  width: number;
  height: number;
  rank: number;
};

export type PositionedGraphEdge = GraphEdge & {
  pathData: string;
  labelX: number;
  labelY: number;
};

export type JourneyLayout = {
  nodes: PositionedGraphNode[];
  edges: PositionedGraphEdge[];
  width: number;
  height: number;
};

export type LayoutOptions = {
  nodeWidth?: number;
  nodeHeight?: number;
  horizontalGap?: number;
  verticalGap?: number;
  padding?: number;
};

const defaultOptions: Required<LayoutOptions> = {
  nodeWidth: 156,
  nodeHeight: 84,
  horizontalGap: 44,
  verticalGap: 20,
  padding: 40,
};

function computeRanks(nodes: GraphNode[], edges: GraphEdge[]) {
  const rank = new Map(nodes.map((node) => [node.id, 0]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));

  for (const edge of edges) {
    if (!indegree.has(edge.targetId) || !outgoing.has(edge.sourceId)) continue;
    indegree.set(edge.targetId, (indegree.get(edge.targetId) ?? 0) + 1);
    outgoing.get(edge.sourceId)?.push(edge.targetId);
  }

  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const queue = nodes
    .filter((node) => indegree.get(node.id) === 0)
    .map((node) => node.id)
    .sort((a, b) => (nodeOrder.get(a) ?? 0) - (nodeOrder.get(b) ?? 0));
  const visited = new Set<string>();

  while (queue.length) {
    const sourceId = queue.shift();
    if (!sourceId) break;
    visited.add(sourceId);
    for (const targetId of outgoing.get(sourceId) ?? []) {
      rank.set(targetId, Math.max(rank.get(targetId) ?? 0, (rank.get(sourceId) ?? 0) + 1));
      indegree.set(targetId, (indegree.get(targetId) ?? 1) - 1);
      if (indegree.get(targetId) === 0) {
        queue.push(targetId);
        queue.sort((a, b) => (nodeOrder.get(a) ?? 0) - (nodeOrder.get(b) ?? 0));
      }
    }
  }

  // Defensive fallback for malformed cyclic input. Runtime-validated fixtures remain acyclic.
  for (const node of nodes) {
    if (!visited.has(node.id)) rank.set(node.id, node.index);
  }

  return rank;
}

function edgePath(source: PositionedGraphNode, target: PositionedGraphNode) {
  const startX = source.x + source.width;
  const startY = source.y + source.height / 2;
  const endX = target.x;
  const endY = target.y + target.height / 2;
  const distance = Math.max(42, (endX - startX) * 0.48);
  return `M ${startX} ${startY} C ${startX + distance} ${startY}, ${endX - distance} ${endY}, ${endX} ${endY}`;
}

export function layoutInvestigationGraph(
  graph: InvestigationGraph,
  options: LayoutOptions = {},
): JourneyLayout {
  const config = { ...defaultOptions, ...options };
  if (!graph.nodes.length) {
    return { nodes: [], edges: [], width: config.padding * 2, height: config.padding * 2 };
  }

  const ranks = computeRanks(graph.nodes, graph.edges);
  const groups = new Map<number, GraphNode[]>();
  for (const node of graph.nodes) {
    const nodeRank = ranks.get(node.id) ?? 0;
    const group = groups.get(nodeRank) ?? [];
    group.push(node);
    groups.set(nodeRank, group);
  }

  for (const group of groups.values()) {
    group.sort(
      (a, b) =>
        (a.path === "primary" ? 0 : 1) - (b.path === "primary" ? 0 : 1) ||
        a.stage.branch - b.stage.branch ||
        a.index - b.index,
    );
  }

  const maxRank = Math.max(...ranks.values());
  const maxLaneCount = Math.max(...[...groups.values()].map((group) => group.length));
  const nodes = graph.nodes.map((node) => {
    const rank = ranks.get(node.id) ?? 0;
    const group = groups.get(rank) ?? [node];
    const lane = Math.max(
      0,
      group.findIndex((candidate) => candidate.id === node.id),
    );
    return {
      ...node,
      x: config.padding + rank * (config.nodeWidth + config.horizontalGap),
      y: config.padding + lane * (config.nodeHeight + config.verticalGap),
      width: config.nodeWidth,
      height: config.nodeHeight,
      rank,
    } satisfies PositionedGraphNode;
  });
  const positionedById = new Map(nodes.map((node) => [node.id, node]));
  const edges = graph.edges.flatMap((edge) => {
    const source = positionedById.get(edge.sourceId);
    const target = positionedById.get(edge.targetId);
    if (!source || !target) return [];
    return [
      {
        ...edge,
        pathData: edgePath(source, target),
        labelX: (source.x + source.width + target.x) / 2,
        labelY: (source.y + source.height / 2 + target.y + target.height / 2) / 2 - 9,
      } satisfies PositionedGraphEdge,
    ];
  });

  return {
    nodes,
    edges,
    width: config.padding * 2 + (maxRank + 1) * config.nodeWidth + maxRank * config.horizontalGap,
    height:
      config.padding * 2 +
      maxLaneCount * config.nodeHeight +
      Math.max(0, maxLaneCount - 1) * config.verticalGap,
  };
}
