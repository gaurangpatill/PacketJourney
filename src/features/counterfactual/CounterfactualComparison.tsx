import { Download, Pause, Play, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { buildInvestigationGraph } from "../journey/graph";
import { JourneyCanvas } from "../journey/JourneyCanvas";
import { JourneyTimeline } from "../journey/JourneyTimeline";
import { layoutInvestigationGraph } from "../journey/layout";
import { useJourneyController } from "../journey/useJourneyController";
import { useReducedMotion } from "../journey/useReducedMotion";
import type { ExpertiseMode, JourneyStage } from "../investigation/schema";
import { serializeCounterfactualExport } from "./export";
import { SIMULATION_LABEL, type CounterfactualResult } from "./schemas";

function downloadResult(result: CounterfactualResult) {
  const blob = new Blob([serializeCounterfactualExport(result)], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `${result.sourceInvestigationId}-${result.scenario.type}-counterfactual.json`;
  anchor.click();
  URL.revokeObjectURL(href);
}

function StageEvidence({ title, stage }: { title: string; stage?: JourneyStage }) {
  return (
    <article className="counterfactual-evidence">
      <span>{title}</span>
      <h4>{stage?.title ?? "No matching stage selected"}</h4>
      {stage?.simulation ? (
        <b>
          {stage.simulation.label} · {stage.simulation.state}
        </b>
      ) : null}
      <dl>
        {stage?.evidence.slice(0, 8).map((evidence) => (
          <div key={evidence.id}>
            <dt>{evidence.label}</dt>
            <dd>
              {typeof evidence.value === "string" || typeof evidence.value === "number"
                ? String(evidence.value)
                : JSON.stringify(evidence.value)}
            </dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export function CounterfactualComparison({
  result,
  expertise,
}: {
  result: CounterfactualResult;
  expertise: ExpertiseMode;
}) {
  const reducedMotion = useReducedMotion();
  const observedGraph = useMemo(() => buildInvestigationGraph(result.observed), [result.observed]);
  const simulatedGraph = useMemo(
    () => buildInvestigationGraph(result.simulated),
    [result.simulated],
  );
  const observedLayout = useMemo(() => layoutInvestigationGraph(observedGraph), [observedGraph]);
  const simulatedLayout = useMemo(() => layoutInvestigationGraph(simulatedGraph), [simulatedGraph]);
  const observed = useJourneyController(observedGraph, reducedMotion);
  const simulated = useJourneyController(simulatedGraph, reducedMotion);
  const [selectedId, setSelectedId] = useState<string>();
  const select = (id: string) => {
    setSelectedId(id);
    if (observedGraph.nodes.some((node) => node.id === id)) observed.selectNode(id);
    if (simulatedGraph.nodes.some((node) => node.id === id)) simulated.selectNode(id);
  };
  const observedStage = result.observed.stages.find((stage) => stage.id === selectedId);
  const simulatedStage = result.simulated.stages.find((stage) => stage.id === selectedId);
  return (
    <div className="counterfactual-result" aria-live="polite">
      <header className="counterfactual-result__header">
        <div>
          <span>{SIMULATION_LABEL}</span>
          <h3>{result.summary.title}</h3>
          <p>{result.summary.description}</p>
        </div>
        <button type="button" onClick={() => downloadResult(result)}>
          <Download size={14} /> Export JSON
        </button>
      </header>
      <div className="counterfactual-transport" aria-label="Synchronized timeline controls">
        <strong>Synchronized playback</strong>
        <button
          type="button"
          onClick={() => {
            observed.play();
            simulated.play();
          }}
          disabled={observed.playing || simulated.playing}
        >
          <Play size={13} /> Play both
        </button>
        <button
          type="button"
          onClick={() => {
            observed.pause();
            simulated.pause();
          }}
        >
          <Pause size={13} /> Pause
        </button>
        <button
          type="button"
          onClick={() => {
            observed.restart();
            simulated.restart();
          }}
        >
          <RotateCcw size={13} /> Restart
        </button>
        <span>
          {reducedMotion
            ? "Reduced motion: stages reveal instantly"
            : "Observed and simulated clocks start together"}
        </span>
      </div>
      <div className="counterfactual-canvases">
        <section className="counterfactual-canvas">
          <header>
            <span>OBSERVED JOURNEY</span>
            <b>MEASURED EVIDENCE</b>
          </header>
          <JourneyCanvas
            graph={observedGraph}
            layout={observedLayout}
            expertise={expertise}
            selectedNodeId={observed.selectedNodeId}
            selectedEdgeId={observed.selectedEdgeId}
            visibleNodeIds={observed.visibleNodeIds}
            playing={observed.playing}
            reducedMotion={reducedMotion}
            onSelectNode={select}
            onSelectEdge={observed.selectEdge}
            onClearSelection={() => {
              setSelectedId(undefined);
              observed.clearSelection();
              simulated.clearSelection();
            }}
          />
          <JourneyTimeline graph={observedGraph} controller={observed} onStageSelect={select} />
        </section>
        <section className="counterfactual-canvas is-simulated">
          <header>
            <span>SIMULATED JOURNEY</span>
            <b>{SIMULATION_LABEL}</b>
          </header>
          <JourneyCanvas
            graph={simulatedGraph}
            layout={simulatedLayout}
            expertise={expertise}
            selectedNodeId={simulated.selectedNodeId}
            selectedEdgeId={simulated.selectedEdgeId}
            visibleNodeIds={simulated.visibleNodeIds}
            playing={simulated.playing}
            reducedMotion={reducedMotion}
            onSelectNode={select}
            onSelectEdge={simulated.selectEdge}
            onClearSelection={() => {
              setSelectedId(undefined);
              observed.clearSelection();
              simulated.clearSelection();
            }}
          />
          <JourneyTimeline graph={simulatedGraph} controller={simulated} onStageSelect={select} />
        </section>
      </div>
      {selectedId ? (
        <div className="counterfactual-evidence-grid">
          <StageEvidence title="Observed evidence" stage={observedStage} />
          <StageEvidence title="Simulated evidence" stage={simulatedStage} />
        </div>
      ) : null}
      <div className="counterfactual-analysis">
        <section>
          <h4>What changed</h4>
          {result.changes
            .filter((change) => change.operation !== "unchanged")
            .slice(0, 18)
            .map((change) => (
              <div className="counterfactual-change" key={change.id}>
                <b>{change.operation}</b>
                <span>{change.targetId}</span>
                <p>{change.reason}</p>
                <small>{change.id}</small>
              </div>
            ))}
        </section>
        <section>
          <h4>Metric policy</h4>
          {result.metricDecisions.map((metric) => (
            <div className="counterfactual-metric" key={metric.metric}>
              <span>{metric.metric}</span>
              <b>{metric.policy}</b>
              <strong>{metric.simulatedValue ?? "unavailable"}</strong>
              <small>{metric.reason}</small>
            </div>
          ))}
        </section>
        <section>
          <h4>Assumptions and limits</h4>
          {result.assumptions.map((assumption) => (
            <div className="counterfactual-assumption" key={assumption.id}>
              <b>{assumption.importance}</b>
              <p>{assumption.statement}</p>
              <small>{assumption.id}</small>
            </div>
          ))}
          {result.unavailableMetrics.length ? (
            <p className="counterfactual-unavailable">
              Unavailable: {result.unavailableMetrics.join(", ")}
            </p>
          ) : null}
        </section>
      </div>
      {result.simulatedFindings.length ? (
        <section className="counterfactual-findings">
          <h4>Simulated findings</h4>
          {result.simulatedFindings.map((finding) => (
            <article key={finding.id}>
              <span>{finding.severity}</span>
              <strong>{finding.title}</strong>
              <p>{finding.explanation}</p>
              <small>{finding.simulation?.label}</small>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
