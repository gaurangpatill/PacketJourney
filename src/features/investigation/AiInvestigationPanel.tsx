import {
  AlertTriangle,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  Square,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { diagnoseInvestigation, InvestigationApiClientError } from "./api";
import type { AiDiagnosis, AiExpertiseMode, CounterfactualAiContext } from "./aiSchema";
import type { ExpertiseMode, Investigation } from "./schema";
import { ReferenceProvenance } from "./ReferenceProvenance";

const expertiseMap: Record<ExpertiseMode, AiExpertiseMode> = {
  beginner: "beginner",
  developer: "developer",
  engineer: "network-engineer",
};

type ConversationTurn = {
  id: string;
  question: string;
  diagnosis?: AiDiagnosis;
  error?: string;
  pending: boolean;
};

function suggestions(investigation: Investigation) {
  const values = [
    "What website are we tracking?",
    investigation.metrics.browserDurationMs !== undefined
      ? "What could slow down this page?"
      : undefined,
    investigation.stages.some((stage) => stage.type === "cache")
      ? "Why was this response not cached?"
      : undefined,
    investigation.stages.some((stage) => stage.type === "tls")
      ? "Is the certificate evidence healthy?"
      : undefined,
    investigation.stages.some((stage) => stage.type === "redirect")
      ? "How many redirects occurred?"
      : undefined,
  ];
  return [...new Set(values.filter((item): item is string => Boolean(item)))].slice(0, 4);
}

function DiagnosisMessage(props: {
  diagnosis: AiDiagnosis;
  investigation: Investigation;
  onEvidenceReference: (stageId: string, evidenceId: string) => void;
  onFollowUp: (question: string) => void;
}) {
  const { diagnosis } = props;
  return (
    <div className={`assistant-answer is-${diagnosis.conclusionType}`}>
      <h3>{diagnosis.summary}</h3>
      <p>{diagnosis.answer}</p>
      <div className="assistant-answer__status">
        {diagnosis.conclusionType === "supported" ? (
          <CheckCircle2 size={15} />
        ) : (
          <AlertTriangle size={15} />
        )}
        <span>
          {diagnosis.conclusionType} · {Math.round(diagnosis.confidence * 100)}% confidence
        </span>
        <small>{diagnosis.source === "workers-ai" ? "Workers AI" : "Evidence engine"}</small>
      </div>

      {diagnosis.evidenceReferences.length > 0 ? (
        <details className="assistant-disclosure">
          <summary>
            <span>{diagnosis.evidenceReferences.length} cited evidence items</span>
            <ChevronDown size={14} />
          </summary>
          <div className="assistant-citations">
            {diagnosis.evidenceReferences.map((item) => (
              <button
                type="button"
                key={`${item.evidenceId}-${item.claim}`}
                onClick={() => props.onEvidenceReference(item.stageId, item.evidenceId)}
              >
                <code>{item.evidenceId}</code>
                <span>{item.claim}</span>
              </button>
            ))}
          </div>
        </details>
      ) : null}

      {diagnosis.uncertainties.length > 0 ? (
        <details className="assistant-disclosure">
          <summary>
            <span>Limits and uncertainty</span>
            <ChevronDown size={14} />
          </summary>
          <div className="assistant-uncertainties">
            {diagnosis.uncertainties.map((item) => (
              <p key={item.statement}>
                <strong>{item.statement}</strong>
                <span>{item.reason}</span>
              </p>
            ))}
          </div>
        </details>
      ) : null}

      {diagnosis.referenceCitations.length > 0 || diagnosis.retrievalMetadata ? (
        <details className="assistant-disclosure">
          <summary>
            <span>Authoritative references</span>
            <ChevronDown size={14} />
          </summary>
          <ReferenceProvenance diagnosis={diagnosis} />
        </details>
      ) : null}

      {diagnosis.prioritizedActions.length > 0 ? (
        <details className="assistant-disclosure">
          <summary>
            <span>{diagnosis.prioritizedActions.length} recommended actions</span>
            <ChevronDown size={14} />
          </summary>
          <ol className="assistant-actions">
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
        </details>
      ) : null}

      {diagnosis.followUpQuestions.length > 0 ? (
        <div className="assistant-followups">
          {diagnosis.followUpQuestions.map((question) => (
            <button type="button" key={question} onClick={() => props.onFollowUp(question)}>
              {question}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AiInvestigationPanel(props: {
  investigation: Investigation;
  expertise: ExpertiseMode;
  selectedStageId?: string;
  counterfactualContext?: CounterfactualAiContext;
  onDiagnosis: (diagnosis: AiDiagnosis) => void;
  onEvidenceReference: (stageId: string, evidenceId: string) => void;
  initialDiagnosis?: AiDiagnosis;
  readOnly?: boolean;
}) {
  const prompts = useMemo(() => suggestions(props.investigation), [props.investigation]);
  const [question, setQuestion] = useState("");
  const initialTurns = useMemo<ConversationTurn[]>(
    () =>
      props.initialDiagnosis
        ? [
            {
              id: `saved-${props.initialDiagnosis.id}`,
              question: props.initialDiagnosis.question,
              diagnosis: props.initialDiagnosis,
              pending: false,
            },
          ]
        : [],
    [props.initialDiagnosis],
  );
  const [turns, setTurns] = useState<ConversationTurn[]>(initialTurns);
  const [referenceMode, setReferenceMode] = useState<"none" | "authoritative">("authoritative");
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const loading = turns.some((turn) => turn.pending);

  useEffect(() => {
    controllerRef.current?.abort();
    controllerRef.current = undefined;
    setTurns(initialTurns);
    setQuestion("");
  }, [initialTurns, props.investigation.id]);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    if (typeof transcript.scrollTo === "function") {
      transcript.scrollTo({ top: transcript.scrollHeight, behavior: "auto" });
    } else {
      transcript.scrollTop = transcript.scrollHeight;
    }
  }, [turns]);

  async function submit(value = question) {
    const next = value.trim();
    if (next.length < 4 || loading || props.readOnly) return;
    const turnId = crypto.randomUUID();
    setQuestion("");
    setTurns((current) => [...current, { id: turnId, question: next, pending: true }]);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const response = await diagnoseInvestigation({
        investigation: props.investigation,
        question: next,
        expertiseMode: expertiseMap[props.expertise],
        selectedStageId: props.selectedStageId,
        counterfactualContext: props.counterfactualContext,
        referenceMode,
        signal: controller.signal,
      });
      setTurns((current) =>
        current.map((turn) =>
          turn.id === turnId ? { ...turn, pending: false, diagnosis: response.diagnosis } : turn,
        ),
      );
      props.onDiagnosis(response.diagnosis);
    } catch (caught) {
      const message = controller.signal.aborted
        ? "Response cancelled. You can retry this question when ready."
        : caught instanceof InvestigationApiClientError
          ? caught.details.message
          : "The evidence-backed diagnosis could not be completed.";
      setTurns((current) =>
        current.map((turn) =>
          turn.id === turnId ? { ...turn, pending: false, error: message } : turn,
        ),
      );
    } finally {
      controllerRef.current = undefined;
    }
  }

  return (
    <aside className="assistant-panel panel" aria-label="Investigation assistant">
      <header className="assistant-panel__header">
        <div>
          <span className="panel-kicker">
            {props.readOnly ? "SAVED EXPLANATION" : "EVIDENCE ASSISTANT"}
          </span>
          <h2>{props.readOnly ? "Investigation record" : "Ask the journey"}</h2>
        </div>
        <span className="assistant-panel__trust">
          <Sparkles size={13} /> {props.readOnly ? "Read only" : "Evidence linked"}
        </span>
      </header>

      <div className="assistant-transcript" aria-live="polite" ref={transcriptRef}>
        {turns.length === 0 ? (
          <div className="assistant-welcome">
            <Sparkles size={18} />
            <strong>
              {props.readOnly ? "No explanation was saved" : "Ask about this investigation"}
            </strong>
            <p>
              {props.readOnly
                ? "This snapshot preserves network evidence but does not include an AI diagnosis."
                : "Direct facts answer immediately. Diagnostic explanations stay tied to evidence."}
            </p>
            {!props.readOnly ? (
              <div className="assistant-suggestions">
                {prompts.map((prompt) => (
                  <button type="button" key={prompt} onClick={() => void submit(prompt)}>
                    {prompt}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {turns.map((turn) => (
          <article className="assistant-turn" key={turn.id}>
            <div className="assistant-question">
              <span>You</span>
              <p>{turn.question}</p>
            </div>
            {turn.pending ? (
              <div className="assistant-progress" role="status">
                <LoaderCircle className="spin" size={15} />
                <span>Reviewing the collected evidence…</span>
              </div>
            ) : null}
            {turn.error ? (
              <div className="assistant-error" role="alert">
                <AlertTriangle size={15} />
                <span>{turn.error}</span>
                <button type="button" onClick={() => void submit(turn.question)}>
                  <RotateCcw size={13} /> Retry
                </button>
              </div>
            ) : null}
            {turn.diagnosis ? (
              <DiagnosisMessage
                diagnosis={turn.diagnosis}
                investigation={props.investigation}
                onEvidenceReference={props.onEvidenceReference}
                onFollowUp={(followUp) => void submit(followUp)}
              />
            ) : null}
          </article>
        ))}
      </div>

      {props.readOnly ? (
        <footer className="assistant-composer assistant-composer--readonly">
          Saved evidence and explanation provenance are preserved in this snapshot.
        </footer>
      ) : (
        <footer className="assistant-composer" data-testid="assistant-composer">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <textarea
              aria-label="Ask about this investigation"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
              placeholder="Ask about this journey…"
              rows={2}
              maxLength={500}
              disabled={loading}
            />
            {loading ? (
              <button
                type="button"
                aria-label="Cancel diagnosis"
                onClick={() => controllerRef.current?.abort()}
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={question.trim().length < 4}
                aria-label="Submit question"
              >
                <ArrowUp size={15} />
              </button>
            )}
          </form>
          <div className="assistant-source-mode" role="group" aria-label="Explanation source mode">
            <button
              type="button"
              aria-pressed={referenceMode === "none"}
              onClick={() => setReferenceMode("none")}
              disabled={loading}
            >
              Evidence only
            </button>
            <button
              type="button"
              aria-pressed={referenceMode === "authoritative"}
              onClick={() => setReferenceMode("authoritative")}
              disabled={loading}
            >
              + references
            </button>
          </div>
        </footer>
      )}
    </aside>
  );
}
