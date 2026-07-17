import {
  AlertTriangle,
  ArrowUp,
  CheckCircle2,
  LoaderCircle,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { diagnoseInvestigation, InvestigationApiClientError } from "./api";
import type { AiDiagnosis, AiExpertiseMode, CounterfactualAiContext } from "./aiSchema";
import type { ExpertiseMode, Investigation } from "./schema";

const expertiseMap: Record<ExpertiseMode, AiExpertiseMode> = {
  beginner: "beginner",
  developer: "developer",
  engineer: "network-engineer",
};

function suggestions(investigation: Investigation) {
  const values = [
    investigation.metrics.browserDurationMs !== undefined
      ? "What is most likely delaying rendering?"
      : undefined,
    investigation.stages.some((stage) => stage.type === "cache")
      ? "Why was this response not cached?"
      : undefined,
    investigation.stages.some((stage) => stage.type === "tls")
      ? "Is the certificate evidence healthy?"
      : undefined,
    investigation.stages.some((stage) => stage.type === "redirect")
      ? "Do the redirects add avoidable work?"
      : undefined,
    "What can the evidence support, and what remains unknown?",
  ];
  return [...new Set(values.filter((item): item is string => Boolean(item)))].slice(0, 4);
}

export function AiInvestigationPanel(props: {
  investigation: Investigation;
  expertise: ExpertiseMode;
  selectedStageId?: string;
  counterfactualContext?: CounterfactualAiContext;
  onDiagnosis: (diagnosis: AiDiagnosis) => void;
  onEvidenceReference: (stageId: string, evidenceId: string) => void;
}) {
  const prompts = useMemo(() => suggestions(props.investigation), [props.investigation]);
  const [question, setQuestion] = useState("");
  const [diagnosis, setDiagnosis] = useState<AiDiagnosis>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const controllerRef = useRef<AbortController | undefined>(undefined);

  async function submit(value = question) {
    const next = value.trim();
    if (next.length < 4 || loading) return;
    setQuestion(next);
    setLoading(true);
    setError(undefined);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const response = await diagnoseInvestigation({
        investigation: props.investigation,
        question: next,
        expertiseMode: expertiseMap[props.expertise],
        selectedStageId: props.selectedStageId,
        counterfactualContext: props.counterfactualContext,
        signal: controller.signal,
      });
      setDiagnosis(response.diagnosis);
      props.onDiagnosis(response.diagnosis);
    } catch (caught) {
      setError(
        caught instanceof InvestigationApiClientError
          ? caught.details.message
          : "The evidence-backed diagnosis could not be completed.",
      );
    } finally {
      controllerRef.current = undefined;
      setLoading(false);
    }
  }

  return (
    <section className="ai-investigator section-shell" aria-labelledby="ai-investigator-title">
      <div className="ai-investigator__heading">
        <div>
          <p className="panel-kicker">EVIDENCE-GROUNDED AI</p>
          <h2 id="ai-investigator-title">Ask this investigation</h2>
        </div>
        <span>
          <Sparkles size={13} /> Conclusions cite collected evidence
        </span>
      </div>
      <form
        className="command-bar"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Sparkles size={17} />
        <input
          aria-label="Ask about this investigation"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Why is this page slow?"
          maxLength={500}
          disabled={loading}
        />
        <span>{loading ? "Reviewing evidence" : "Workers AI"}</span>
        {loading ? (
          <button
            type="button"
            aria-label="Cancel diagnosis"
            onClick={() => controllerRef.current?.abort()}
          >
            <LoaderCircle className="spin" size={15} />
          </button>
        ) : (
          <button type="submit" disabled={question.trim().length < 4} aria-label="Submit question">
            <ArrowUp size={15} />
          </button>
        )}
      </form>
      {!diagnosis && !error ? (
        <div className="ai-suggestions" aria-label="Suggested investigation questions">
          {prompts.map((prompt) => (
            <button key={prompt} type="button" onClick={() => void submit(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
      ) : null}
      {error ? (
        <div className="ai-error" role="alert">
          <AlertTriangle size={16} />
          <span>{error}</span>
          <button type="button" onClick={() => void submit()}>
            <RotateCcw size={13} /> Retry
          </button>
        </div>
      ) : null}
      {diagnosis ? (
        <article className={`ai-diagnosis is-${diagnosis.conclusionType}`} aria-live="polite">
          <header>
            {diagnosis.conclusionType === "supported" ? (
              <CheckCircle2 size={17} />
            ) : (
              <AlertTriangle size={17} />
            )}
            <div>
              <span>
                {diagnosis.conclusionType} · {Math.round(diagnosis.confidence * 100)}% confidence
              </span>
              <h3>{diagnosis.summary}</h3>
            </div>
            <small>{diagnosis.source === "fixture" ? "LOCAL FIXTURE" : diagnosis.model}</small>
          </header>
          <p>{diagnosis.answer}</p>
          {diagnosis.evidenceReferences.length ? (
            <div className="ai-references">
              <strong>Evidence used</strong>
              {diagnosis.evidenceReferences.map((reference) => (
                <button
                  type="button"
                  key={`${reference.evidenceId}-${reference.claim}`}
                  onClick={() => props.onEvidenceReference(reference.stageId, reference.evidenceId)}
                >
                  <code>{reference.evidenceId}</code>
                  <span>{reference.claim}</span>
                </button>
              ))}
            </div>
          ) : null}
          {diagnosis.counterfactualReferences?.length ? (
            <div className="ai-references">
              <strong>Simulation provenance</strong>
              {diagnosis.counterfactualReferences.map((reference) => (
                <div key={`${reference.type}-${reference.id}`}>
                  <code>{reference.id}</code>
                  <span>{reference.claim}</span>
                </div>
              ))}
            </div>
          ) : null}
          {diagnosis.uncertainties.length ? (
            <div className="ai-uncertainties">
              <strong>What remains uncertain</strong>
              {diagnosis.uncertainties.map((item) => (
                <p key={item.statement}>
                  {item.statement} <span>{item.reason}</span>
                </p>
              ))}
            </div>
          ) : null}
          {diagnosis.prioritizedActions.length ? (
            <ol className="ai-actions">
              {diagnosis.prioritizedActions.map((action) => (
                <li key={`${action.priority}-${action.title}`}>
                  <b>{action.priority}</b>
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        const evidenceId = action.evidenceIds[0];
                        const stage = props.investigation.stages.find((candidate) =>
                          candidate.evidence.some((item) => item.id === evidenceId),
                        );
                        if (stage && evidenceId) props.onEvidenceReference(stage.id, evidenceId);
                      }}
                    >
                      {action.title}
                    </button>
                    <span>{action.rationale}</span>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
          {diagnosis.followUpQuestions.length ? (
            <div className="ai-followups">
              <strong>Continue investigating</strong>
              {diagnosis.followUpQuestions.map((item) => (
                <button type="button" key={item} onClick={() => void submit(item)}>
                  {item}
                </button>
              ))}
            </div>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}
