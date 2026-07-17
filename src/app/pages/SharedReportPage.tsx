import { AlertTriangle, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { InvestigationWorkspace } from "../../features/investigation/InvestigationWorkspace";
import { InvestigationApiClientError } from "../../features/investigation/api";
import { getSharedReport } from "../../features/persistence/api";
import type { SharedReport } from "../../features/persistence/schema";

export function SharedReportPage() {
  const { token = "" } = useParams();
  const [report, setReport] = useState<SharedReport>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    void getSharedReport(token)
      .then(setReport)
      .catch((caught) => {
        const code = caught instanceof InvestigationApiClientError ? caught.details.code : "";
        setError(
          code === "share_expired"
            ? "This shared report has expired."
            : code === "share_revoked"
              ? "This shared report was revoked."
              : "This shared report is unavailable.",
        );
      });
  }, [token]);
  if (error)
    return (
      <section className="centered-state centered-state--error section-shell">
        <AlertTriangle />
        <p className="eyebrow">
          <span /> Saved snapshot
        </p>
        <h1>Report unavailable</h1>
        <p>{error}</p>
        <Link to="/">Return to Packet Journey</Link>
      </section>
    );
  if (!report)
    return (
      <section className="saved-library__state section-shell">
        <LoaderCircle className="spin" /> Loading read-only report…
      </section>
    );
  return (
    <>
      <div className="shared-report-heading section-shell">
        <div>
          <span>{report.label}</span>
          <span>{report.access}</span>
          <strong>{report.title}</strong>
        </div>
        <Link to={`/investigate?url=${encodeURIComponent(report.requestedUrl)}`}>
          <RefreshCw size={14} /> Run a fresh investigation
        </Link>
      </div>
      <InvestigationWorkspace
        investigation={report.investigation}
        snapshot={{
          kind: "shared",
          capturedAt: report.capturedAt,
          freshnessNotice: report.freshnessNotice,
          title: report.title,
        }}
        persistedDiagnosis={report.selectedDiagnosis}
        persistedCounterfactual={report.selectedCounterfactual}
      />
      <section className="runtime-limitations section-shell panel">
        <h2>Snapshot limitations</h2>
        {report.runtimeLimitations.map((item) => (
          <p key={item}>{item}</p>
        ))}
      </section>
    </>
  );
}
