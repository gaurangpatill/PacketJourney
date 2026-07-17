import {
  AlertTriangle,
  ArrowUp,
  Check,
  ChevronRight,
  Clock3,
  Download,
  Info,
  Link2,
  MoreHorizontal,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { UrlInvestigationForm } from "../../components/UrlInvestigationForm";
import { EvidenceInspector } from "../journey/EvidenceInspector";
import { buildInvestigationGraph } from "../journey/graph";
import { JourneyCanvas } from "../journey/JourneyCanvas";
import { JourneyTimeline } from "../journey/JourneyTimeline";
import { layoutInvestigationGraph } from "../journey/layout";
import { useJourneyController } from "../journey/useJourneyController";
import { useReducedMotion } from "../journey/useReducedMotion";
import type { ExpertiseMode, Investigation } from "./schema";
import type { InvestigationApiError } from "./httpApi";
import { StageIcon } from "./StageIcon";
import { BrowserEvidencePanels } from "./BrowserEvidencePanels";

const expertiseCopy: Record<ExpertiseMode, { label: string; intro: string }> = {
  beginner: {
    label: "Beginner",
    intro: "Your browser passes through several systems before it can show the page.",
  },
  developer: {
    label: "Developer",
    intro: "Inspect the request lifecycle, response behavior, and browser-visible evidence.",
  },
  engineer: {
    label: "Network engineer",
    intro: "Review protocol negotiation, edge disposition, timings, and evidence provenance.",
  },
};

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

export function InvestigationWorkspace({
  investigation,
  partialError,
}: {
  investigation: Investigation;
  partialError?: InvestigationApiError;
}) {
  const hasBrowserEvidence = investigation.stages.some((stage) => stage.id === "browser-complete");
  const [expertise, setExpertise] = useState<ExpertiseMode>("developer");
  const [activeDetail, setActiveDetail] = useState<
    "overview" | "dns" | "tls" | "cache" | "browser"
  >("overview");
  const graph = useMemo(() => buildInvestigationGraph(investigation), [investigation]);
  const layout = useMemo(() => layoutInvestigationGraph(graph), [graph]);
  const reducedMotion = useReducedMotion();
  const controller = useJourneyController(graph, reducedMotion);
  const selectedNode = graph.nodes.find((node) => node.id === controller.selectedNodeId);
  const selectedEdge = graph.edges.find((edge) => edge.id === controller.selectedEdgeId);
  const mainFinding = investigation.findings[0];

  return (
    <div className="workspace">
      <header className="workspace-header section-shell">
        <div className="workspace-header__form">
          <UrlInvestigationForm compact initialValue={investigation.normalizedUrl} />
          <span className={`investigation-status investigation-status--${investigation.status}`}>
            <i /> {investigation.status}
          </span>
        </div>
        <div className="workspace-header__tools">
          <label className="expertise-select">
            <span className="sr-only">Expertise mode</span>
            <select
              value={expertise}
              onChange={(event) => setExpertise(event.target.value as ExpertiseMode)}
            >
              {Object.entries(expertiseCopy).map(([value, item]) => (
                <option value={value} key={value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="icon-button"
            type="button"
            aria-label="Share is available in Layer 9"
            title="Available in Layer 9"
            disabled
          >
            <Link2 size={16} />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Export is available in Layer 9"
            title="Available in Layer 9"
            disabled
          >
            <Download size={16} />
          </button>
          <button className="icon-button" type="button" aria-label="More actions">
            <MoreHorizontal size={17} />
          </button>
        </div>
      </header>

      <div className={`mock-banner${investigation.mock ? "" : " mock-banner--live"}`} role="note">
        <Info size={14} />
        {investigation.mock ? (
          <span>
            <strong>Recorded example</strong> Stable fixture evidence for repeatable product demos.
          </span>
        ) : (
          <span>
            <strong>{partialError ? "Partial live result" : "Live network evidence"}</strong>
            {partialError
              ? ` The Worker stopped at ${partialError.stage ?? "HTTP"}: ${partialError.message}`
              : hasBrowserEvidence
                ? " Collected by the Cloudflare Worker with DNS, certificate, HTTP, and isolated browser diagnostics."
                : " Collected by the Cloudflare Worker with DNS, certificate, redirect, and HTTP diagnostics; browser evidence was unavailable."}
          </span>
        )}
      </div>

      <section className="investigation-title section-shell">
        <div>
          <p className="eyebrow">
            <span /> Investigation / {investigation.id}
          </p>
          <h1>{investigation.title}</h1>
          <p>
            {expertiseCopy[expertise].intro} {investigation.summary}
          </p>
        </div>
        <div className="investigation-title__meta">
          <span>
            <Clock3 size={13} /> Collected {investigation.createdAt.slice(11, 16)} UTC
          </span>
          <span>
            <ShieldCheck size={13} />{" "}
            {investigation.stages.flatMap((stage) => stage.evidence).length} evidence items
          </span>
        </div>
      </section>

      <section className="workspace-grid section-shell">
        <div className="journey-panel panel">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">REQUEST JOURNEY</p>
              <h2>
                {investigation.mock || hasBrowserEvidence
                  ? "URL to browser evidence"
                  : "URL to document response"}
              </h2>
            </div>
            <div className="panel-heading__legend">
              <span>
                <i className="legend-primary" /> Primary path
              </span>
              <span>
                <i className="legend-warning" /> Attention
              </span>
              <span>
                <i className="legend-inferred" /> Inferred
              </span>
            </div>
          </div>
          <JourneyCanvas
            graph={graph}
            layout={layout}
            expertise={expertise}
            selectedNodeId={controller.selectedNodeId}
            selectedEdgeId={controller.selectedEdgeId}
            visibleNodeIds={controller.visibleNodeIds}
            playing={controller.playing}
            reducedMotion={reducedMotion}
            onSelectNode={controller.selectNode}
            onSelectEdge={controller.selectEdge}
            onClearSelection={controller.clearSelection}
          />
          <JourneyTimeline graph={graph} controller={controller} />
        </div>
        <EvidenceInspector
          graph={graph}
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          expertise={expertise}
        />
      </section>

      <section
        className="command-bar section-shell"
        aria-label="Natural language investigation preview"
      >
        <Sparkles size={17} />
        <input
          aria-label="Investigation command"
          placeholder="Ask a question or control the journey…"
          disabled
        />
        <span>AI tools · Layer 7</span>
        <button type="button" disabled aria-label="Submit command">
          <ArrowUp size={15} />
        </button>
      </section>

      <section className="analysis-section section-shell">
        <div className="detail-tabs" role="tablist" aria-label="Investigation details">
          {(["overview", "dns", "tls", "cache", "browser"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeDetail === tab}
              onClick={() => setActiveDetail(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="metrics-grid">
          <Metric
            label="Total journey"
            value={`${investigation.metrics.totalDurationMs} ms`}
            note={
              investigation.mock
                ? "URL to recorded completion"
                : investigation.metrics.browserDurationMs === undefined
                  ? "Worker investigation duration"
                  : "Worker and browser orchestration"
            }
          />
          <Metric
            label="DNS lookup"
            value={`${investigation.metrics.dnsMs ?? "—"}${investigation.metrics.dnsMs === undefined ? "" : " ms"}`}
            note={
              investigation.metrics.dnsMs === undefined
                ? "Unavailable for this journey"
                : "Resolver duration"
            }
          />
          <Metric
            label="Certificate probe"
            value={`${investigation.metrics.tlsMs ?? "—"}${investigation.metrics.tlsMs === undefined ? "" : " ms"}`}
            note={
              investigation.metrics.tlsMs === undefined
                ? "Unavailable for this journey"
                : "Independent probe duration"
            }
          />
          <Metric
            label="Time to first byte"
            value={`${investigation.metrics.timeToFirstByteMs ?? "—"}${investigation.metrics.timeToFirstByteMs === undefined ? "" : " ms"}`}
            note={
              investigation.metrics.timeToFirstByteMs === undefined
                ? "Not exposed by Worker fetch"
                : "Document response"
            }
          />
          <Metric
            label="Requests"
            value={String(investigation.metrics.requestCount ?? "—")}
            note={`${investigation.metrics.thirdPartyCount ?? 0} third-party`}
          />
          <Metric
            label="Browser FCP"
            value={`${investigation.metrics.firstContentfulPaintMs ?? "—"}${investigation.metrics.firstContentfulPaintMs === undefined ? "" : " ms"}`}
            note={
              investigation.metrics.firstContentfulPaintMs === undefined
                ? "Unavailable in this session"
                : "One lab browser session"
            }
          />
        </div>

        <BrowserEvidencePanels investigation={investigation} />

        <div className="analysis-grid">
          <div className="finding-panel panel">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">TOP FINDING</p>
                <h2>{mainFinding?.title ?? "No findings"}</h2>
              </div>
              {mainFinding?.severity === "high" || mainFinding?.severity === "medium" ? (
                <AlertTriangle size={18} />
              ) : (
                <Check size={18} />
              )}
            </div>
            {mainFinding ? (
              <>
                <p>{mainFinding.explanation}</p>
                <div className="finding-confidence">
                  <span>{Math.round(mainFinding.confidence * 100)}% confidence</span>
                  <i>
                    <b style={{ width: `${mainFinding.confidence * 100}%` }} />
                  </i>
                </div>
                {mainFinding.recommendation ? (
                  <div className="recommendation">
                    <strong>Suggested next step</strong>
                    <span>{mainFinding.recommendation}</span>
                  </div>
                ) : null}
              </>
            ) : (
              <p>
                {investigation.mock
                  ? "This recorded journey has no diagnostic findings."
                  : "No deterministic HTTP findings were generated from the collected evidence."}
              </p>
            )}
          </div>
          <div className="stage-list-panel panel">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">STAGE INDEX</p>
                <h2>
                  {activeDetail === "overview"
                    ? "All observed stages"
                    : `${activeDetail.toUpperCase()} detail`}
                </h2>
              </div>
              <Search size={16} />
            </div>
            <div className="stage-index">
              {investigation.stages
                .filter((stage) => activeDetail === "overview" || stage.type === activeDetail)
                .map((stage) => (
                  <button
                    type="button"
                    key={stage.id}
                    onClick={() => {
                      controller.selectNode(stage.id);
                      const journeyPanel = document.querySelector(".journey-panel");
                      if (
                        journeyPanel instanceof HTMLElement &&
                        typeof journeyPanel.scrollIntoView === "function"
                      ) {
                        journeyPanel.scrollIntoView({ behavior: "smooth", block: "center" });
                      }
                    }}
                  >
                    <StageIcon type={stage.type} size={15} />
                    <span>
                      <strong>{stage.title}</strong>
                      <small>{stage.evidence.length} evidence items</small>
                    </span>
                    <b>{stage.durationMs === undefined ? "—" : `${stage.durationMs} ms`}</b>
                    <ChevronRight size={14} />
                  </button>
                ))}
              {investigation.stages.every(
                (stage) => activeDetail !== "overview" && stage.type !== activeDetail,
              ) ? (
                <p className="muted-empty">
                  This journey did not produce a {activeDetail.toUpperCase()} stage.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
