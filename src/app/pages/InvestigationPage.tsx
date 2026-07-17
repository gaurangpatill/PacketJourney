import { AlertTriangle, ArrowLeft, LoaderCircle, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { UrlInvestigationForm } from "../../components/UrlInvestigationForm";
import { investigationById } from "../../data/investigations";
import {
  createHttpInvestigation,
  InvestigationApiClientError,
} from "../../features/investigation/api";
import { InvestigationWorkspace } from "../../features/investigation/InvestigationWorkspace";
import type { InvestigationApiError } from "../../features/investigation/httpApi";
import type { Investigation } from "../../features/investigation/schema";
import { normalizePublicUrl } from "../../features/investigation/url";

const PROGRESS_MESSAGES = [
  "Validating the public destination and DNS safety policy…",
  "Tracing HTTP redirects with bounded requests…",
  "Collecting allowlisted response headers and timing…",
  "Applying deterministic cache and security rules…",
  "Launching an isolated Cloudflare browser session…",
  "Collecting page resources, rendering milestones, and screenshot evidence…",
  "Building the evidence-backed journey…",
];
const CLIENT_TIMEOUT_MS = 60_000;

type LiveState =
  | { status: "idle" }
  | { status: "loading"; progressIndex: number }
  | { status: "success"; investigation: Investigation; partialError?: InvestigationApiError }
  | { status: "error"; error: InvestigationApiError };

export function InvestigationPage() {
  const { investigationId } = useParams();
  const [searchParams] = useSearchParams();
  const requestedUrl = searchParams.get("url");
  const [attempt, setAttempt] = useState(0);
  const [liveState, setLiveState] = useState<LiveState>({ status: "idle" });

  const urlResult = useMemo(
    () => (requestedUrl ? normalizePublicUrl(requestedUrl) : undefined),
    [requestedUrl],
  );
  const recordedInvestigation = investigationId
    ? investigationById.get(investigationId)
    : undefined;

  useEffect(() => {
    if (investigationId || !requestedUrl || !urlResult?.ok) {
      setLiveState({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    const progress = window.setInterval(() => {
      setLiveState((state) =>
        state.status === "loading"
          ? {
              status: "loading",
              progressIndex: Math.min(state.progressIndex + 1, PROGRESS_MESSAGES.length - 1),
            }
          : state,
      );
    }, 1_400);
    setLiveState({ status: "loading", progressIndex: 0 });

    void createHttpInvestigation(urlResult.normalizedUrl, { signal: controller.signal })
      .then((result) => {
        setLiveState({
          status: "success",
          investigation: result.investigation,
          partialError: result.partialError,
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLiveState({
          status: "error",
          error:
            error instanceof InvestigationApiClientError
              ? error.details
              : {
                  code: "unexpected_client_error",
                  message: "The live investigation could not be completed.",
                  retryable: true,
                },
        });
      })
      .finally(() => {
        window.clearTimeout(timeout);
        window.clearInterval(progress);
      });

    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
      window.clearInterval(progress);
    };
  }, [attempt, investigationId, requestedUrl, urlResult]);

  if (liveState.status === "loading") {
    return (
      <section className="loading-state section-shell" aria-live="polite">
        <div className="loading-state__orb">
          <LoaderCircle size={24} />
        </div>
        <p className="eyebrow">
          <span /> Live Worker investigation
        </p>
        <h1>Reconstructing the page journey…</h1>
        <p>{PROGRESS_MESSAGES[liveState.progressIndex]}</p>
        <div className="loading-steps" aria-hidden="true">
          {PROGRESS_MESSAGES.map((message, index) => (
            <i key={message} className={index <= liveState.progressIndex ? "is-active" : ""} />
          ))}
        </div>
      </section>
    );
  }

  if (requestedUrl && urlResult && !urlResult.ok) {
    return (
      <section className="centered-state centered-state--error section-shell">
        <AlertTriangle size={30} />
        <p className="eyebrow">
          <span /> Invalid destination
        </p>
        <h1>We couldn't prepare that URL.</h1>
        <p>{urlResult.message}</p>
        <UrlInvestigationForm />
      </section>
    );
  }

  if (liveState.status === "error") {
    return (
      <section className="centered-state centered-state--error section-shell" aria-live="assertive">
        <AlertTriangle size={30} />
        <p className="eyebrow">
          <span /> Live investigation stopped
        </p>
        <code>{liveState.error.code}</code>
        <h1>The Worker couldn't complete this journey.</h1>
        <p>
          {liveState.error.message}
          {liveState.error.stage
            ? ` The investigation stopped during ${liveState.error.stage}.`
            : ""}
        </p>
        <div className="live-error-actions">
          {liveState.error.retryable ? (
            <button
              className="button button--primary"
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              <RotateCcw size={16} /> Retry investigation
            </button>
          ) : null}
          <Link className="button button--secondary" to="/explore">
            <ArrowLeft size={16} /> Open recorded demos
          </Link>
        </div>
      </section>
    );
  }

  if (!recordedInvestigation && investigationId) {
    return (
      <section className="centered-state centered-state--error section-shell">
        <AlertTriangle size={30} />
        <p className="eyebrow">
          <span /> Investigation unavailable
        </p>
        <h1>This journey could not be found.</h1>
        <p>The recorded investigation ID is missing or no longer available.</p>
        <Link className="button button--secondary" to="/explore">
          <ArrowLeft size={16} /> Browse scenarios
        </Link>
      </section>
    );
  }

  const investigation =
    recordedInvestigation ?? (liveState.status === "success" ? liveState.investigation : undefined);

  if (!investigation) {
    return (
      <section className="empty-investigation section-shell">
        <div>
          <p className="eyebrow">
            <span /> Start a journey
          </p>
          <h1>What happens behind this URL?</h1>
          <p>
            Enter a public website to run a real HTTP investigation, or choose a recorded example
            for a stable demonstration of later protocol and browser stages.
          </p>
          <UrlInvestigationForm />
        </div>
        <div className="empty-investigation__diagram" aria-hidden="true">
          <span>URL</span>
          <i />
          <span>HTTP</span>
          <i />
          <span>Cache</span>
          <i />
          <span>Doc</span>
        </div>
      </section>
    );
  }

  return (
    <InvestigationWorkspace
      investigation={investigation}
      partialError={liveState.status === "success" ? liveState.partialError : undefined}
    />
  );
}
