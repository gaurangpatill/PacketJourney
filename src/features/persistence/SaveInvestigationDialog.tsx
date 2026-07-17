import { AlertTriangle, Check, Database, LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import type { CounterfactualResult } from "../counterfactual/schemas";
import type { AiDiagnosis, AiExpertiseMode } from "../investigation/aiSchema";
import type { Investigation } from "../investigation/schema";
import { InvestigationApiClientError } from "../investigation/api";
import { saveInvestigation } from "./api";

export function SaveInvestigationDialog({
  investigation,
  diagnosis,
  expertiseMode,
  counterfactual,
  onClose,
}: {
  investigation: Investigation;
  diagnosis?: AiDiagnosis;
  expertiseMode: AiExpertiseMode;
  counterfactual?: CounterfactualResult;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(investigation.title);
  const [includeDiagnosis, setIncludeDiagnosis] = useState(Boolean(diagnosis));
  const [includeCounterfactual, setIncludeCounterfactual] = useState(Boolean(counterfactual));
  const [preserveScreenshot, setPreserveScreenshot] = useState(true);
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "saving" }
    | { status: "error"; message: string }
    | { status: "saved"; id: string; warnings: string[] }
  >({ status: "idle" });

  async function submit() {
    setState({ status: "saving" });
    try {
      const result = await saveInvestigation({
        title,
        investigation,
        ...(includeDiagnosis && diagnosis
          ? { selectedDiagnosis: { diagnosis, expertiseMode } }
          : {}),
        ...(includeCounterfactual && counterfactual
          ? { selectedCounterfactual: counterfactual }
          : {}),
        preserveScreenshot,
      });
      setState({ status: "saved", id: result.saved.summary.id, warnings: result.warnings });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof InvestigationApiClientError
            ? error.details.message
            : "The investigation could not be saved.",
      });
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="save-dialog panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="icon-button save-dialog__close" type="button" onClick={onClose}>
          <X size={16} /> <span className="sr-only">Close save dialog</span>
        </button>
        <p className="panel-kicker">D1 SNAPSHOT</p>
        <h2 id="save-dialog-title">Save this investigation</h2>
        <p>
          The verified investigation is captured as a versioned snapshot. Network evidence is not
          rerun when you open it later.
        </p>
        {state.status === "saved" ? (
          <div className="save-dialog__success" role="status">
            <Check size={20} />
            <strong>Investigation saved</strong>
            <span>Stored for this browser installation.</span>
            {state.warnings.map((warning) => (
              <small key={warning}>{warning}</small>
            ))}
            <a className="button button--primary" href={`/saved/${state.id}`}>
              Open saved snapshot
            </a>
          </div>
        ) : (
          <>
            <label>
              <span>Title</span>
              <input
                value={title}
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <div className="save-dialog__options">
              <label>
                <input
                  type="checkbox"
                  checked={includeDiagnosis}
                  disabled={!diagnosis}
                  onChange={(event) => setIncludeDiagnosis(event.target.checked)}
                />
                Include the selected AI diagnosis
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={includeCounterfactual}
                  disabled={!counterfactual}
                  onChange={(event) => setIncludeCounterfactual(event.target.checked)}
                />
                Include the selected deterministic simulation
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={preserveScreenshot}
                  onChange={(event) => setPreserveScreenshot(event.target.checked)}
                />
                Preserve the screenshot for 30 days when available
              </label>
            </div>
            <small>
              Anonymous ownership uses an HttpOnly installation cookie. It is not an account and
              will not follow you to another browser.
            </small>
            {state.status === "error" ? (
              <p className="save-dialog__error" role="alert">
                <AlertTriangle size={14} /> {state.message}
              </p>
            ) : null}
            <button
              className="button button--primary"
              type="button"
              disabled={!title.trim() || state.status === "saving"}
              onClick={() => void submit()}
            >
              {state.status === "saving" ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <Database size={15} />
              )}
              {state.status === "saving" ? "Saving snapshot…" : "Save investigation"}
            </button>
          </>
        )}
      </section>
    </div>
  );
}
