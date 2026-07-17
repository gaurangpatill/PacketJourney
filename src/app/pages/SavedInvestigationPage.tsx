import { AlertTriangle, ArrowLeft, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { InvestigationWorkspace } from "../../features/investigation/InvestigationWorkspace";
import { getSavedInvestigation } from "../../features/persistence/api";
import type { SavedInvestigationDetail } from "../../features/persistence/schema";
import { ShareManager } from "../../features/persistence/ShareManager";

export function SavedInvestigationPage() {
  const { savedId = "" } = useParams();
  const [detail, setDetail] = useState<SavedInvestigationDetail>();
  const [error, setError] = useState(false);
  useEffect(() => {
    void getSavedInvestigation(savedId)
      .then(setDetail)
      .catch(() => setError(true));
  }, [savedId]);
  if (error)
    return (
      <section className="centered-state centered-state--error section-shell">
        <AlertTriangle />
        <h1>Saved investigation unavailable</h1>
        <p>
          It may have been deleted, belong to another browser installation, or require the D1
          migration.
        </p>
        <Link to="/saved">Back to history</Link>
      </section>
    );
  if (!detail)
    return (
      <section className="saved-library__state section-shell">
        <LoaderCircle className="spin" /> Loading saved snapshot…
      </section>
    );
  return (
    <>
      <div className="snapshot-actions section-shell">
        <Link to="/saved">
          <ArrowLeft size={14} /> History
        </Link>
        <Link to={`/investigate?url=${encodeURIComponent(detail.investigation.normalizedUrl)}`}>
          <RefreshCw size={14} /> Run a fresh investigation
        </Link>
      </div>
      <InvestigationWorkspace
        investigation={detail.investigation}
        snapshot={{
          kind: "saved",
          capturedAt: detail.investigation.completedAt ?? detail.investigation.createdAt,
          freshnessNotice: detail.freshnessNotice,
          title: detail.summary.title,
        }}
        persistedDiagnosis={detail.selectedDiagnosis}
        persistedCounterfactual={detail.selectedCounterfactual}
      />
      <div className="section-shell">
        <ShareManager investigationId={detail.summary.id} />
      </div>
    </>
  );
}
