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
  nodeWidth: 208,
  nodeHeight: 112,
  horizontalGap: 52,
  verticalGap: 54,
  padding: 42,
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

function edgePath(
  source: PositionedGraphNode,
  target: PositionedGraphNode,
  relationship: GraphEdge["relationship"],
) {
  if (source.path === "primary" && target.path === "secondary") {
    const startX = source.x + source.width / 2;
    const startY = source.y + source.height;
    const endX = target.x + target.width / 2;
    const endY = target.y;
    const bend = Math.max(42, (endY - startY) * 0.52);
    return `M ${startX} ${startY} C ${startX} ${startY + bend}, ${endX} ${endY - bend}, ${endX} ${endY}`;
  }
  if (source.path === "secondary" && target.path === "primary") {
    const startX = source.x + source.width / 2;
    const startY = source.y;
    const endX = target.x + target.width / 2;
    const endY = target.y + target.height;
    const bend = Math.max(42, (startY - endY) * 0.52);
    return `M ${startX} ${startY} C ${startX} ${startY - bend}, ${endX} ${endY + bend}, ${endX} ${endY}`;
  }
  const startX = source.x + source.width;
  const startY = source.y + source.height / 2;
  const endX = target.x;
  const endY = target.y + target.height / 2;
  const distance = Math.max(
    54,
    Math.abs(endX - startX) * (relationship === "return" ? 0.36 : 0.48),
  );
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
  const primaryNodes = graph.primaryNodeIds
    .map((id) => graph.nodes.find((node) => node.id === id))
    .filter((node): node is GraphNode => Boolean(node));
  const primaryOrder = new Map(primaryNodes.map((node, index) => [node.id, index]));
  const secondaryNodes = graph.nodes
    .filter((node) => !primaryOrder.has(node.id))
    .sort((left, right) => left.stage.branch - right.stage.branch || left.index - right.index);
  const secondaryOrder = new Map(secondaryNodes.map((node, index) => [node.id, index]));
  const secondaryColumns = Math.min(5, Math.max(1, secondaryNodes.length));
  const primaryY = config.padding;
  const secondaryStartY = primaryY + config.nodeHeight + config.verticalGap;
  const primaryStep = config.nodeWidth + config.horizontalGap;
  const branchSourceCounts = new Map<string, number>();
  for (const edge of graph.edges) {
    if (!primaryOrder.has(edge.sourceId) || !secondaryOrder.has(edge.targetId)) continue;
    branchSourceCounts.set(edge.sourceId, (branchSourceCounts.get(edge.sourceId) ?? 0) + 1);
  }
  const branchAnchorId = [...branchSourceCounts.entries()].sort(
    (left, right) =>
      right[1] - left[1] || (primaryOrder.get(left[0]) ?? 0) - (primaryOrder.get(right[0]) ?? 0),
  )[0]?.[0];
  const branchAnchorIndex = branchAnchorId ? (primaryOrder.get(branchAnchorId) ?? 0) : 0;
  const secondaryRowWidth =
    secondaryColumns * config.nodeWidth + Math.max(0, secondaryColumns - 1) * config.horizontalGap;
  const branchAnchorCenter =
    config.padding + branchAnchorIndex * primaryStep + config.nodeWidth / 2;
  const secondaryStartX = Math.max(config.padding, branchAnchorCenter - secondaryRowWidth / 2);

  const nodes = graph.nodes.map((node) => {
    const rank = ranks.get(node.id) ?? 0;
    const primaryIndex = primaryOrder.get(node.id);
    const secondaryIndex = secondaryOrder.get(node.id) ?? 0;
    const column = secondaryIndex % secondaryColumns;
    const row = Math.floor(secondaryIndex / secondaryColumns);
    return {
      ...node,
      x:
        primaryIndex === undefined
          ? secondaryStartX + column * primaryStep
          : config.padding + primaryIndex * primaryStep,
      y:
        primaryIndex === undefined
          ? secondaryStartY + row * (config.nodeHeight + config.verticalGap)
          : primaryY,
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
        pathData: edgePath(source, target, edge.relationship),
        labelX: (source.x + source.width + target.x) / 2,
        labelY: (source.y + source.height / 2 + target.y + target.height / 2) / 2 - 9,
      } satisfies PositionedGraphEdge,
    ];
  });

  return {
    nodes,
    edges,
    width: Math.max(
      config.padding * 2 +
        primaryNodes.length * config.nodeWidth +
        Math.max(0, primaryNodes.length - 1) * config.horizontalGap,
      secondaryStartX + secondaryRowWidth + config.padding,
    ),
    height:
      config.padding * 2 +
      config.nodeHeight +
      (secondaryNodes.length > 0
        ? config.verticalGap +
          Math.ceil(secondaryNodes.length / secondaryColumns) * config.nodeHeight +
          Math.max(0, Math.ceil(secondaryNodes.length / secondaryColumns) - 1) * config.verticalGap
        : 0),
  };
}
