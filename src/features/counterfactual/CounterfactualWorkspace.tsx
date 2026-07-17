import { AlertTriangle, FlaskConical, History, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import type { ExpertiseMode, Investigation } from "../investigation/schema";
import { runCounterfactual } from "./engine";
import { createScenario } from "./scenarioFactory";
import type { CounterfactualResult } from "./schemas";
import { suggestCounterfactuals } from "./suggestions";
import { CounterfactualError } from "./types";
import { CounterfactualComparison } from "./CounterfactualComparison";
import { AiInvestigationPanel } from "../investigation/AiInvestigationPanel";
import type { CounterfactualAiContext } from "../investigation/aiSchema";

const failureTypes = new Set(["expire-certificate", "remove-dns-address"]);
const scenarioMetadataKeys = new Set(["id", "title", "description", "createdAt", "source"]);

function scenarioSignature(item: CounterfactualResult) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(item.scenario)
        .filter(([key]) => !scenarioMetadataKeys.has(key))
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

function aiContext(result: CounterfactualResult): CounterfactualAiContext {
  return {
    label: result.label,
    scenarioId: result.scenario.id,
    ruleId: result.simulated.simulation!.ruleId,
    engineVersion: result.engineVersion,
    changes: result.changes.slice(0, 24).map((change) => ({
      id: change.id,
      targetId: change.targetId,
      operation: change.operation,
      reason: change.reason,
      sourceEvidenceIds: change.sourceEvidenceIds,
    })),
    assumptions: result.assumptions.slice(0, 16).map((assumption) => ({
      id: assumption.id,
      statement: assumption.statement,
      importance: assumption.importance,
    })),
  };
}

export function CounterfactualWorkspace({
  investigation,
  expertise,
  onResult,
}: {
  investigation: Investigation;
  expertise: ExpertiseMode;
  onResult?: (result: CounterfactualResult | undefined) => void;
}) {
  const suggestions = useMemo(() => suggestCounterfactuals(investigation), [investigation]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = suggestions[selectedIndex];
  const [durationMs, setDurationMs] = useState<number>();
  const [reductionPercent, setReductionPercent] = useState(50);
  const [targetId, setTargetId] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<CounterfactualResult>();
  const [showAiExplanation, setShowAiExplanation] = useState(false);
  const [history, setHistory] = useState<CounterfactualResult[]>([]);
  const [error, setError] = useState<string>();
  const targetOptions = selected
    ? [...selected.targetStageIds, ...(selected.targetResourceIds ?? [])]
    : [];

  function run() {
    if (!selected) return;
    if (failureTypes.has(selected.type) && !confirmed) {
      setError("Confirm that this scenario intentionally introduces a simulated failure.");
      return;
    }
    try {
      const createdAt = new Date().toISOString();
      const scenario = createScenario(
        investigation,
        selected,
        { durationMs, reductionPercent, selectedTargetId: targetId },
        { id: `cf-${selected.type}-${Date.now()}`, createdAt },
      );
      const next = runCounterfactual(investigation, scenario);
      setResult(next);
      onResult?.(next);
      setHistory((current) =>
        [
          next,
          ...current.filter((item) => scenarioSignature(item) !== scenarioSignature(next)),
        ].slice(0, 5),
      );
      setShowAiExplanation(false);
      setError(undefined);
    } catch (caught) {
      setError(
        caught instanceof CounterfactualError
          ? caught.message
          : "The deterministic simulation could not be validated.",
      );
    }
  }

  if (!suggestions.length) return null;
  return (
    <section
      className="counterfactual-workspace section-shell"
      aria-labelledby="counterfactual-title"
    >
      <div className="counterfactual-heading">
        <div>
          <p className="panel-kicker">DETERMINISTIC COUNTERFACTUAL DEBUGGING</p>
          <h2 id="counterfactual-title">Change one rule. Compare the journey.</h2>
          <p>
            Observed evidence stays immutable. Every changed value is rule-derived and labeled as
            simulated—not measured.
          </p>
        </div>
        <span>
          <FlaskConical size={15} /> Client-side rule engine
        </span>
      </div>
      <div className="counterfactual-config panel">
        <label>
          <span>Scenario</span>
          <select
            value={selectedIndex}
            onChange={(event) => {
              setSelectedIndex(Number(event.target.value));
              setTargetId(undefined);
              setConfirmed(false);
              setError(undefined);
            }}
          >
            {suggestions.map((item, index) => (
              <option value={index} key={`${item.type}-${item.targetStageIds.join("-")}`}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        {selected?.type === "reduce-origin-latency" ? (
          <label>
            <span>Target duration (ms)</span>
            <input
              type="number"
              min={0}
              value={durationMs ?? ""}
              placeholder="50% of observed"
              onChange={(event) =>
                setDurationMs(event.target.value ? Number(event.target.value) : undefined)
              }
            />
          </label>
        ) : null}
        {selected?.type === "reduce-javascript" ? (
          <label>
            <span>Transfer reduction</span>
            <input
              type="number"
              min={1}
              max={95}
              value={reductionPercent}
              onChange={(event) => setReductionPercent(Number(event.target.value))}
            />
            <small>{reductionPercent}%</small>
          </label>
        ) : null}
        {targetOptions.length > 1 &&
        selected?.type !== "remove-redirects" &&
        selected?.type !== "enable-edge-cache" ? (
          <label>
            <span>Target</span>
            <select
              value={targetId ?? targetOptions[0]}
              onChange={(event) => setTargetId(event.target.value)}
            >
              {targetOptions.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="counterfactual-config__reason">
          <strong>Why suggested</strong>
          <span>{selected?.reason}</span>
          <small>{selected?.description}</small>
        </div>
        {selected && failureTypes.has(selected.type) ? (
          <label className="counterfactual-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              I understand this introduces a simulated failure and does not alter the observed
              result.
            </span>
          </label>
        ) : null}
        <button className="counterfactual-run" type="button" onClick={run}>
          <FlaskConical size={14} /> Run deterministic simulation
        </button>
        {error ? (
          <p className="counterfactual-error" role="alert">
            <AlertTriangle size={14} /> {error}
          </p>
        ) : null}
      </div>
      {history.length ? (
        <div className="counterfactual-history">
          <span>
            <History size={13} /> Session history
          </span>
          {history.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === result?.id ? "is-active" : undefined}
              onClick={() => setResult(item)}
            >
              {item.scenario.title}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setHistory([]);
              setResult(undefined);
              onResult?.(undefined);
            }}
          >
            <RotateCcw size={12} /> Clear
          </button>
        </div>
      ) : null}
      {result ? (
        <>
          <CounterfactualComparison result={result} expertise={expertise} />
          <div className="counterfactual-ai-boundary">
            <div>
              <strong>Optional AI explanation</strong>
              <span>
                AI receives the completed, validated simulated investigation. It can explain
                evidence and uncertainty; it cannot select a rule, change a value, or run the
                simulation.
              </span>
            </div>
            <button type="button" onClick={() => setShowAiExplanation((current) => !current)}>
              {showAiExplanation ? "Hide AI explanation" : "Explain simulation with AI"}
            </button>
          </div>
          {showAiExplanation ? (
            <AiInvestigationPanel
              investigation={result.simulated}
              expertise={expertise}
              counterfactualContext={aiContext(result)}
              onDiagnosis={() => undefined}
              onEvidenceReference={(stageId) =>
                document
                  .querySelector(`[data-node-id="${CSS.escape(stageId)}"]`)
                  ?.scrollIntoView({ block: "center" })
              }
            />
          ) : null}
        </>
      ) : (
        <div className="counterfactual-empty">
          <FlaskConical size={22} />
          <strong>No simulation has run</strong>
          <span>
            Select a supported evidence-backed scenario. Packet Journey will not make a request or
            alter the observed investigation.
          </span>
        </div>
      )}
    </section>
  );
}
