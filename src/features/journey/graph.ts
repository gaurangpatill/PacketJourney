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
