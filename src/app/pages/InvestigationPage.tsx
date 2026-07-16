import { AlertTriangle, ArrowLeft, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { UrlInvestigationForm } from "../../components/UrlInvestigationForm";
import { investigationById, investigationForUrl } from "../../data/investigations";
import { InvestigationWorkspace } from "../../features/investigation/InvestigationWorkspace";
import { normalizePublicUrl } from "../../features/investigation/url";

export function InvestigationPage() {
  const { investigationId } = useParams();
  const [searchParams] = useSearchParams();
  const requestedUrl = searchParams.get("url");
  const [loading, setLoading] = useState(Boolean(requestedUrl));

  const urlResult = useMemo(
    () => (requestedUrl ? normalizePublicUrl(requestedUrl) : undefined),
    [requestedUrl],
  );
  const investigation = useMemo(() => {
    if (investigationId) return investigationById.get(investigationId);
    if (urlResult?.ok) return investigationForUrl(urlResult.normalizedUrl);
    return undefined;
  }, [investigationId, urlResult]);

  useEffect(() => {
    if (!requestedUrl) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => setLoading(false), 700);
    return () => window.clearTimeout(timer);
  }, [requestedUrl]);

  if (loading) {
    return (
      <section className="loading-state section-shell" aria-live="polite">
        <div className="loading-state__orb">
          <LoaderCircle size={24} />
        </div>
        <p className="eyebrow">
          <span /> Preparing investigation
        </p>
        <h1>Building the journey workspace…</h1>
        <p>Loading stable fixture evidence for this Layer 1 preview.</p>
        <div className="loading-steps" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
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

  if (!investigation && investigationId) {
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

  if (!investigation) {
    return (
      <section className="empty-investigation section-shell">
        <div>
          <p className="eyebrow">
            <span /> Start a journey
          </p>
          <h1>What happens behind this URL?</h1>
          <p>
            Enter a public website to open the investigation workspace. Layer 1 returns clearly
            labeled recorded evidence while live collection is under construction.
          </p>
          <UrlInvestigationForm />
        </div>
        <div className="empty-investigation__diagram" aria-hidden="true">
          <span>URL</span>
          <i />
          <span>DNS</span>
          <i />
          <span>TLS</span>
          <i />
          <span>...</span>
        </div>
      </section>
    );
  }

  return <InvestigationWorkspace investigation={investigation} />;
}
