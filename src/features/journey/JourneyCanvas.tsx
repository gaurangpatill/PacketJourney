import { Focus, LocateFixed, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExpertiseMode } from "../investigation/schema";
import { StageIcon } from "../investigation/StageIcon";
import type { InvestigationGraph } from "./graph";
import type { JourneyLayout, PositionedGraphNode } from "./layout";
import { accessibleNodeLabel, nodeDescription, nodeTitle } from "./presentation";

type Viewport = { x: number; y: number; scale: number };
type CanvasSize = { width: number; height: number };

const minScale = 0.18;
const maxScale = 2;

function clampScale(scale: number) {
  return Math.min(maxScale, Math.max(minScale, scale));
}

function edgeMarker(relationship: string) {
  if (relationship === "failure") return "url(#arrow-error)";
  if (relationship === "redirect") return "url(#arrow-warning)";
  if (relationship === "return") return "url(#arrow-return)";
  return "url(#arrow-default)";
}

type JourneyCanvasProps = {
  graph: InvestigationGraph;
  layout: JourneyLayout;
  expertise: ExpertiseMode;
  selectedNodeId?: string;
  selectedEdgeId?: string;
  visibleNodeIds: ReadonlySet<string>;
  playing: boolean;
  reducedMotion: boolean;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onClearSelection: () => void;
  emphasizedNodeIds?: ReadonlySet<string>;
  aiDimmedNodeIds?: ReadonlySet<string>;
};

export function JourneyCanvas({
  graph,
  layout,
  expertise,
  selectedNodeId,
  selectedEdgeId,
  visibleNodeIds,
  playing,
  reducedMotion,
  onSelectNode,
  onSelectEdge,
  onClearSelection,
  emphasizedNodeIds = new Set(),
  aiDimmedNodeIds = new Set(),
}: JourneyCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<
    { pointerId: number; x: number; y: number; originX: number; originY: number } | undefined
  >(undefined);
  const [size, setSize] = useState<CanvasSize>({ width: 900, height: 420 });
  const [viewport, setViewport] = useState<Viewport>({ x: 24, y: 24, scale: 1 });
  const [panning, setPanning] = useState(false);

  const fitView = useCallback(() => {
    const scale = clampScale(
      Math.min((size.width - 48) / layout.width, (size.height - 48) / layout.height, 1.15),
    );
    setViewport({
      scale,
      x: (size.width - layout.width * scale) / 2,
      y: (size.height - layout.height * scale) / 2,
    });
  }, [layout.height, layout.width, size.height, size.width]);

  const resetView = useCallback(() => {
    setViewport({ x: 24, y: Math.max(24, (size.height - layout.height) / 2), scale: 1 });
  }, [layout.height, size.height]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setSize({ width: rect.width, height: rect.height });
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => fitView(), [fitView, graph]);

  const directlyRelated = useMemo(() => {
    if (!selectedNodeId) return new Set<string>();
    return new Set(
      graph.edges
        .filter((edge) => edge.sourceId === selectedNodeId || edge.targetId === selectedNodeId)
        .flatMap((edge) => [edge.sourceId, edge.targetId]),
    );
  }, [graph.edges, selectedNodeId]);

  const zoomAt = useCallback((nextScale: number, clientX?: number, clientY?: number) => {
    setViewport((current) => {
      const scale = clampScale(nextScale);
      const rect = containerRef.current?.getBoundingClientRect();
      const pointX = clientX !== undefined && rect ? clientX - rect.left : (rect?.width ?? 0) / 2;
      const pointY = clientY !== undefined && rect ? clientY - rect.top : (rect?.height ?? 0) / 2;
      const worldX = (pointX - current.x) / current.scale;
      const worldY = (pointY - current.y) / current.scale;
      return { scale, x: pointX - worldX * scale, y: pointY - worldY * scale };
    });
  }, []);

  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
    };
    setPanning(true);
    onClearSelection();
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    setViewport((current) => ({
      ...current,
      x: pan.originX + event.clientX - pan.x,
      y: pan.originY + event.clientY - pan.y,
    }));
  }

  function stopPanning(event: React.PointerEvent<SVGSVGElement>) {
    if (panRef.current?.pointerId === event.pointerId) panRef.current = undefined;
    setPanning(false);
  }

  function handleNodeKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    node: PositionedGraphNode,
  ) {
    if (event.key === "Escape") {
      onClearSelection();
      event.currentTarget.blur();
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const connected =
      event.key === "ArrowRight"
        ? graph.edges.filter((edge) => edge.sourceId === node.id).map((edge) => edge.targetId)
        : event.key === "ArrowLeft"
          ? graph.edges.filter((edge) => edge.targetId === node.id).map((edge) => edge.sourceId)
          : [];
    const sameRank = layout.nodes
      .filter((candidate) => candidate.rank === node.rank && candidate.id !== node.id)
      .sort((a, b) => a.y - b.y);
    const verticalTarget =
      event.key === "ArrowUp"
        ? [...sameRank].reverse().find((candidate) => candidate.y < node.y)
        : sameRank.find((candidate) => candidate.y > node.y);
    const targetId = connected[0] ?? verticalTarget?.id;
    if (targetId) {
      const target = [
        ...(containerRef.current?.querySelectorAll<HTMLElement>("[data-node-id]") ?? []),
      ].find((element) => element.dataset.nodeId === targetId);
      target?.focus();
    }
  }

  if (!layout.nodes.length) {
    return (
      <div className="graph-empty" role="status">
        <Focus size={24} />
        <strong>No journey stages</strong>
        <span>This investigation did not produce a renderable graph.</span>
      </div>
    );
  }

  return (
    <div
      className={`graph-canvas${panning ? " is-panning" : ""}`}
      ref={containerRef}
      data-testid="journey-canvas"
    >
      <svg
        width="100%"
        height="100%"
        role="group"
        aria-label="Interactive request journey graph"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopPanning}
        onPointerCancel={stopPanning}
        onWheel={(event) => {
          event.preventDefault();
          zoomAt(viewport.scale * Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClearSelection();
        }}
      >
        <defs>
          <pattern id="canvas-grid" width="28" height="28" patternUnits="userSpaceOnUse">
            <path d="M 28 0 L 0 0 0 28" fill="none" stroke="currentColor" strokeWidth="0.6" />
          </pattern>
          <marker
            id="arrow-default"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 Z" />
          </marker>
          <marker
            id="arrow-warning"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 Z" />
          </marker>
          <marker id="arrow-error" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" />
          </marker>
          <marker
            id="arrow-return"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 Z" />
          </marker>
        </defs>
        <rect
          className="graph-canvas__grid"
          width="100%"
          height="100%"
          fill="url(#canvas-grid)"
          pointerEvents="none"
        />
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
          <g className="graph-edges" aria-label="Journey relationships">
            {layout.edges.map((edge) => {
              const visible =
                visibleNodeIds.has(edge.sourceId) && visibleNodeIds.has(edge.targetId);
              const selected = selectedEdgeId === edge.id;
              const related =
                selectedNodeId &&
                (edge.sourceId === selectedNodeId || edge.targetId === selectedNodeId);
              const dimmed = Boolean((selectedNodeId && !related) || (selectedEdgeId && !selected));
              return (
                <g
                  className={`graph-edge graph-edge--${edge.relationship}${selected ? " is-selected" : ""}${dimmed ? " is-dimmed" : ""}${visible ? " is-visible" : " is-hidden"}${playing && visible && !reducedMotion ? " is-playing" : ""}`}
                  key={edge.id}
                >
                  <path
                    className="graph-edge__hit"
                    d={edge.pathData}
                    onClick={() => onSelectEdge(edge.id)}
                    aria-label={`${edge.label}: ${edge.detail ?? "connected stages"}`}
                    role="button"
                    tabIndex={visible ? 0 : -1}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectEdge(edge.id);
                      }
                    }}
                  />
                  <path
                    className="graph-edge__line"
                    d={edge.pathData}
                    markerEnd={edgeMarker(edge.relationship)}
                    pointerEvents="none"
                  />
                  {(selected ||
                    edge.relationship === "redirect" ||
                    edge.relationship === "return") &&
                  visible ? (
                    <g className="graph-edge__label" pointerEvents="none">
                      <rect
                        x={edge.labelX - 42}
                        y={edge.labelY - 10}
                        width="84"
                        height="20"
                        rx="4"
                      />
                      <text x={edge.labelX} y={edge.labelY + 3} textAnchor="middle">
                        {edge.label}
                      </text>
                    </g>
                  ) : null}
                </g>
              );
            })}
          </g>
          <g className="graph-nodes" aria-label="Journey stages">
            {layout.nodes.map((node) => {
              const visible = visibleNodeIds.has(node.id);
              const selected = selectedNodeId === node.id;
              const dimmed = Boolean(
                (selectedNodeId && !selected && !directlyRelated.has(node.id)) ||
                selectedEdgeId ||
                aiDimmedNodeIds.has(node.id),
              );
              const emphasized = emphasizedNodeIds.has(node.id);
              return (
                <foreignObject
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  className={`graph-node-shell${visible ? " is-visible" : " is-hidden"}`}
                  key={node.id}
                >
                  <button
                    type="button"
                    data-node-id={node.id}
                    className={`graph-node graph-node--${node.stage.type} is-${node.stage.status}${node.path === "secondary" ? " is-secondary" : ""}${node.confidence === "inferred" ? " is-inferred" : ""}${node.isBottleneck ? " is-bottleneck" : ""}${selected ? " is-selected" : ""}${emphasized ? " is-ai-emphasized" : ""}${dimmed ? " is-dimmed" : ""}`}
                    aria-label={accessibleNodeLabel(node.stage, expertise)}
                    aria-pressed={selected}
                    tabIndex={visible ? 0 : -1}
                    onClick={() => onSelectNode(node.id)}
                    onKeyDown={(event) => handleNodeKeyDown(event, node)}
                  >
                    <span className="graph-node__top">
                      <i>
                        <StageIcon type={node.stage.type} size={16} />
                      </i>
                      <b>{node.stage.status}</b>
                      {node.isBottleneck ? <em>BOTTLENECK</em> : null}
                    </span>
                    <span className="graph-node__title">{nodeTitle(node.stage, expertise)}</span>
                    <span className="graph-node__summary">
                      {nodeDescription(node.stage, expertise)}
                    </span>
                    <span className="graph-node__meta">
                      <b>
                        {node.stage.durationMs === undefined ? "—" : `${node.stage.durationMs} ms`}
                      </b>
                      <i>{node.stage.evidence.length} evidence</i>
                      <i>{node.confidence}</i>
                    </span>
                  </button>
                </foreignObject>
              );
            })}
          </g>
        </g>
      </svg>
      <div className="graph-controls" aria-label="Graph view controls">
        <button type="button" onClick={() => zoomAt(viewport.scale * 1.2)} aria-label="Zoom in">
          <Plus size={15} />
        </button>
        <button type="button" onClick={() => zoomAt(viewport.scale / 1.2)} aria-label="Zoom out">
          <Minus size={15} />
        </button>
        <span />
        <button type="button" onClick={fitView} aria-label="Fit journey to view">
          <Focus size={15} />
        </button>
        <button type="button" onClick={resetView} aria-label="Reset graph view">
          <LocateFixed size={15} />
        </button>
        <output aria-label="Zoom level">{Math.round(viewport.scale * 100)}%</output>
      </div>
      <p className="graph-hint">Drag to pan · Scroll to zoom · Arrow keys to navigate</p>
    </div>
  );
}
