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
  PanelRight,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { UrlInvestigationForm } from "../../components/UrlInvestigationForm";
import type { EvidenceItem, ExpertiseMode, Investigation, JourneyStage } from "./schema";
import { JourneyPreview } from "./JourneyPreview";
import { StageIcon } from "./StageIcon";

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

function formatEvidenceValue(value: unknown) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function stageExplanation(stage: JourneyStage, mode: ExpertiseMode) {
  if (mode === "beginner") {
    const beginner: Partial<Record<JourneyStage["type"], string>> = {
      input: "The browser begins by asking for this webpage.",
      dns: "DNS finds the network address associated with the website's name.",
      tls: "The browser checks the site's identity and creates an encrypted connection.",
      redirect: "The server sends the browser to a different address before continuing.",
      edge: "A nearby network location receives the request.",
      cache: "The edge checks whether it already has a reusable copy.",
      origin: "The website's main server prepares the response.",
      browser: "The browser turns the response into visible pixels.",
      "third-party": "An outside service is contacted by the page.",
      error: "The journey cannot continue beyond this point.",
    };
    return beginner[stage.type] ?? stage.description;
  }
  return stage.description;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function EvidenceRow({ item, detailed }: { item: EvidenceItem; detailed: boolean }) {
  return (
    <div className="evidence-row">
      <div>
        <span>{item.label}</span>
        <strong>{formatEvidenceValue(item.value)}</strong>
      </div>
      {detailed ? (
        <div className="evidence-row__source">
          {item.confidence === "verified" ? <Check size={11} /> : <Info size={11} />}
          {item.confidence} · {item.source}
        </div>
      ) : null}
    </div>
  );
}

export function InvestigationWorkspace({ investigation }: { investigation: Investigation }) {
  const [expertise, setExpertise] = useState<ExpertiseMode>("developer");
  const [selectedStageId, setSelectedStageId] = useState(investigation.stages[0]?.id ?? "");
  const [activeDetail, setActiveDetail] = useState<"overview" | "dns" | "tls" | "cache">(
    "overview",
  );
  const selectedStage = useMemo(
    () =>
      investigation.stages.find((stage) => stage.id === selectedStageId) ?? investigation.stages[0],
    [investigation.stages, selectedStageId],
  );
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

      <div className="mock-banner" role="note">
        <Info size={14} /> <strong>Recorded demo</strong> This workspace uses stable fixture
        evidence. Live diagnostics begin in Layer 3.
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
            <Clock3 size={13} /> Collected 04:15 UTC
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
              <h2>URL to first render</h2>
            </div>
            <div className="panel-heading__legend">
              <span>
                <i className="legend-success" /> Verified
              </span>
              <span>
                <i className="legend-warning" /> Attention
              </span>
            </div>
          </div>
          <div className="journey-canvas">
            <div className="journey-canvas__grid" aria-hidden="true" />
            <JourneyPreview
              investigation={investigation}
              selectedStageId={selectedStageId}
              onSelectStage={setSelectedStageId}
            />
          </div>
          <div className="timeline-strip">
            <span>0 ms</span>
            <div>
              <i
                style={{
                  width: `${Math.min(100, ((selectedStage?.durationMs ?? 0) / Math.max(investigation.metrics.totalDurationMs, 1)) * 100)}%`,
                }}
              />
            </div>
            <span>{investigation.metrics.totalDurationMs} ms</span>
          </div>
        </div>

        <aside className="evidence-panel panel" aria-label="Evidence inspector">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">EVIDENCE INSPECTOR</p>
              <h2>{selectedStage?.title ?? "Select a stage"}</h2>
            </div>
            <PanelRight size={16} />
          </div>
          {selectedStage ? (
            <div className="evidence-panel__content">
              <div className={`stage-summary stage-summary--${selectedStage.status}`}>
                <span>
                  <StageIcon type={selectedStage.type} />
                </span>
                <p>{stageExplanation(selectedStage, expertise)}</p>
              </div>
              <div className="evidence-list">
                {selectedStage.evidence.length ? (
                  selectedStage.evidence.map((item) => (
                    <EvidenceRow item={item} detailed={expertise === "engineer"} key={item.id} />
                  ))
                ) : (
                  <p className="muted-empty">No evidence attached to this stage.</p>
                )}
              </div>
              <div className="confidence-note">
                <ShieldCheck size={14} />
                <div>
                  <strong>Evidence integrity</strong>
                  <span>Values are fixture-backed and never model-generated.</span>
                </div>
              </div>
            </div>
          ) : null}
        </aside>
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
          {(["overview", "dns", "tls", "cache"] as const).map((tab) => (
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
            note="URL to recorded completion"
          />
          <Metric
            label="DNS lookup"
            value={`${investigation.metrics.dnsMs ?? "—"}${investigation.metrics.dnsMs === undefined ? "" : " ms"}`}
            note="Resolver duration"
          />
          <Metric
            label="Time to first byte"
            value={`${investigation.metrics.timeToFirstByteMs ?? "—"}${investigation.metrics.timeToFirstByteMs === undefined ? "" : " ms"}`}
            note="Document response"
          />
          <Metric
            label="Requests"
            value={String(investigation.metrics.requestCount ?? "—")}
            note={`${investigation.metrics.thirdPartyCount ?? 0} third-party`}
          />
        </div>

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
              <p>This recorded journey has no diagnostic findings.</p>
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
                      setSelectedStageId(stage.id);
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
