import type { EvidenceItem, Finding, Investigation, JourneyStage } from "../investigation/schema";

export type GraphRelationship =
  "primary" | "return" | "redirect" | "resource" | "inferred" | "failure";

export type GraphNode = {
  id: string;
  stage: JourneyStage;
  index: number;
  path: "primary" | "secondary";
  confidence: "verified" | "inferred";
  isBottleneck: boolean;
  relatedFindings: Finding[];
};

export type GraphEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  relationship: GraphRelationship;
  label: string;
  detail?: string;
  evidence: EvidenceItem[];
  path: "primary" | "secondary";
};

export type InvestigationGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  primaryNodeIds: string[];
  rootIds: string[];
  terminalIds: string[];
  bottleneckId?: string;
};

export type JourneyGraphProjection = {
  graph: InvestigationGraph;
  hiddenBranchNodeIds: ReadonlySet<string>;
  hiddenBranchCount: number;
  totalBranchCount: number;
};

type GraphSource = Pick<Investigation, "stages" | "findings" | "metrics">;

function evidenceByLabel(stage: JourneyStage, pattern: RegExp) {
  return stage.evidence.find((item) => pattern.test(item.label));
}

function readableValue(item: EvidenceItem | undefined) {
  if (!item) return undefined;
  if (typeof item.value === "string" || typeof item.value === "number") return String(item.value);
  return undefined;
}

function choosePrimaryTarget(targets: JourneyStage[]) {
  return [...targets].sort((a, b) => {
    const aSecondary = a.type === "third-party" || a.branch > 0 ? 1 : 0;
    const bSecondary = b.type === "third-party" || b.branch > 0 ? 1 : 0;
    return aSecondary - bSecondary || a.branch - b.branch;
  })[0];
}

function findPrimaryPath(stages: JourneyStage[], byId: Map<string, JourneyStage>) {
  if (!stages.length) return [];

  const incoming = new Set(stages.flatMap((stage) => stage.connections));
  const root = stages.find((stage) => !incoming.has(stage.id)) ?? stages[0];
  if (!root) return [];

  const path: string[] = [];
  const visited = new Set<string>();
  let current: JourneyStage | undefined = root;

  while (current && !visited.has(current.id)) {
    path.push(current.id);
    visited.add(current.id);
    const targets = current.connections
      .map((targetId) => byId.get(targetId))
      .filter((stage): stage is JourneyStage => Boolean(stage));
    current = choosePrimaryTarget(targets);
  }

  return path;
}

function classifyRelationship(source: JourneyStage, target: JourneyStage, primary: boolean) {
  if (source.status === "error" || target.status === "error" || target.type === "error") {
    return "failure" satisfies GraphRelationship;
  }
  if (source.type === "redirect") return "redirect" satisfies GraphRelationship;
  if (source.type === "origin" && target.type === "edge") {
    return "return" satisfies GraphRelationship;
  }
  if (target.type === "resource") return "resource" satisfies GraphRelationship;
  if (
    target.type === "third-party" ||
    target.evidence.some((item) => item.confidence === "inferred")
  ) {
    return "inferred" satisfies GraphRelationship;
  }
  return primary
    ? ("primary" satisfies GraphRelationship)
    : ("resource" satisfies GraphRelationship);
}

function relationshipCopy(source: JourneyStage, target: JourneyStage, kind: GraphRelationship) {
  if (kind === "redirect") {
    const status = readableValue(evidenceByLabel(source, /^status$/i));
    const destination = readableValue(evidenceByLabel(source, /location|destination/i));
    return {
      label: status ? `${status} redirect` : "Redirect",
      detail: destination ? `Destination: ${destination}` : undefined,
      evidence: source.evidence,
    };
  }
  if (kind === "failure") {
    return { label: "Journey stopped", detail: target.description, evidence: target.evidence };
  }
  if (kind === "return") {
    return {
      label: "Response return",
      detail: "Origin response returned through the edge",
      evidence: target.evidence,
    };
  }
  if (kind === "resource" || kind === "inferred") {
    const domain = readableValue(evidenceByLabel(target, /domain/i));
    return {
      label: kind === "inferred" ? "Inferred dependency" : "Resource load",
      detail: domain ? `${target.title} · ${domain}` : target.title,
      evidence: target.evidence,
    };
  }
  return { label: "Request path", detail: `${source.title} → ${target.title}`, evidence: [] };
}

export function buildInvestigationGraph(source: GraphSource): InvestigationGraph {
  const uniqueStages = source.stages.filter(
    (stage, index, stages) => stages.findIndex((candidate) => candidate.id === stage.id) === index,
  );
  const byId = new Map(uniqueStages.map((stage) => [stage.id, stage]));
  const primaryNodeIds = findPrimaryPath(uniqueStages, byId);
  const primarySet = new Set(primaryNodeIds);
  const durations = uniqueStages.filter((stage) => stage.durationMs !== undefined);
  const bottleneck = [...durations].sort(
    (a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0) || a.id.localeCompare(b.id),
  )[0];
  const bottleneckId =
    bottleneck &&
    (bottleneck.durationMs ?? 0) >= Math.max(100, source.metrics.totalDurationMs * 0.25)
      ? bottleneck.id
      : undefined;

  const nodes: GraphNode[] = uniqueStages.map((stage, index) => ({
    id: stage.id,
    stage,
    index,
    path: primarySet.has(stage.id) ? "primary" : "secondary",
    confidence:
      stage.evidence.length > 0 && stage.evidence.every((item) => item.confidence === "inferred")
        ? "inferred"
        : "verified",
    isBottleneck: stage.id === bottleneckId,
    relatedFindings: source.findings.filter((finding) =>
      finding.evidenceIds.some((evidenceId) =>
        stage.evidence.some((item) => item.id === evidenceId),
      ),
    ),
  }));

  const edges = uniqueStages.flatMap((sourceStage) =>
    sourceStage.connections.flatMap((targetId) => {
      const targetStage = byId.get(targetId);
      if (!targetStage || targetStage.id === sourceStage.id) return [];
      const isPrimary = primarySet.has(sourceStage.id) && primarySet.has(targetStage.id);
      const relationship = classifyRelationship(sourceStage, targetStage, isPrimary);
      const copy = relationshipCopy(sourceStage, targetStage, relationship);
      return [
        {
          id: `${sourceStage.id}::${targetStage.id}`,
          sourceId: sourceStage.id,
          targetId: targetStage.id,
          relationship,
          label: copy.label,
          detail: copy.detail,
          evidence: copy.evidence,
          path: isPrimary ? "primary" : "secondary",
        } satisfies GraphEdge,
      ];
    }),
  );

  const targetIds = new Set(edges.map((edge) => edge.targetId));
  const sourceIds = new Set(edges.map((edge) => edge.sourceId));

  return {
    nodes,
    edges,
    primaryNodeIds,
    rootIds: nodes.filter((node) => !targetIds.has(node.id)).map((node) => node.id),
    terminalIds: nodes.filter((node) => !sourceIds.has(node.id)).map((node) => node.id),
    bottleneckId,
  };
}

const branchStatusPriority: Record<JourneyStage["status"], number> = {
  error: 0,
  warning: 1,
  active: 2,
  pending: 3,
  success: 4,
};

/**
 * Creates a canvas-only projection without mutating the canonical investigation graph.
 * Resource stages are already deterministic aggregates; this limits how many aggregates
 * compete with the primary request path until the user asks to inspect every branch.
 */
export function projectJourneyGraph(
  source: InvestigationGraph,
  options: { expanded?: boolean; branchLimit?: number } = {},
): JourneyGraphProjection {
  const branchLimit = Math.max(1, options.branchLimit ?? 4);
  const branchNodes = source.nodes.filter(
    (node) =>
      node.path === "secondary" &&
      (node.stage.type === "resource" || node.stage.type === "third-party"),
  );
  if (options.expanded || branchNodes.length <= branchLimit) {
    return {
      graph: source,
      hiddenBranchNodeIds: new Set(),
      hiddenBranchCount: 0,
      totalBranchCount: branchNodes.length,
    };
  }

  const retainedBranches = new Set(
    [...branchNodes]
      .sort(
        (left, right) =>
          (left.isBottleneck ? 0 : 1) - (right.isBottleneck ? 0 : 1) ||
          branchStatusPriority[left.stage.status] - branchStatusPriority[right.stage.status] ||
          left.stage.branch - right.stage.branch ||
          left.index - right.index,
      )
      .slice(0, branchLimit)
      .map((node) => node.id),
  );
  const hiddenBranchNodeIds = new Set(
    branchNodes.filter((node) => !retainedBranches.has(node.id)).map((node) => node.id),
  );
  const nodes = source.nodes.filter((node) => !hiddenBranchNodeIds.has(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = source.edges.filter(
    (edge) => nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId),
  );
  const targetIds = new Set(edges.map((edge) => edge.targetId));
  const sourceIds = new Set(edges.map((edge) => edge.sourceId));

  return {
    graph: {
      ...source,
      nodes,
      edges,
      primaryNodeIds: source.primaryNodeIds.filter((id) => nodeIds.has(id)),
      rootIds: nodes.filter((node) => !targetIds.has(node.id)).map((node) => node.id),
      terminalIds: nodes.filter((node) => !sourceIds.has(node.id)).map((node) => node.id),
      ...(source.bottleneckId && nodeIds.has(source.bottleneckId)
        ? { bottleneckId: source.bottleneckId }
        : { bottleneckId: undefined }),
    },
    hiddenBranchNodeIds,
    hiddenBranchCount: hiddenBranchNodeIds.size,
    totalBranchCount: branchNodes.length,
  };
}
