import { AlertTriangle, Database, ExternalLink, LoaderCircle, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  deleteSavedInvestigation,
  listSavedInvestigations,
  renameSavedInvestigation,
} from "../../features/persistence/api";
import type { SavedInvestigationSummary } from "../../features/persistence/schema";

export function SavedInvestigationsPage() {
  const [items, setItems] = useState<SavedInvestigationSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [sourceType, setSourceType] = useState("");
  const [hostname, setHostname] = useState("");

  async function load(cursor?: string, append = false) {
    setState("loading");
    try {
      const query = new URLSearchParams({ limit: "20" });
      if (sourceType) query.set("sourceType", sourceType);
      if (hostname.trim()) query.set("hostname", hostname.trim());
      if (cursor) query.set("cursor", cursor);
      const response = await listSavedInvestigations(query.toString());
      setItems((current) => (append ? [...current, ...response.items] : response.items));
      setNextCursor(response.nextCursor);
      setState("ready");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    void load();
    // Filters are applied explicitly to avoid request churn while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function rename(item: SavedInvestigationSummary) {
    const title = window.prompt("Rename saved investigation", item.title)?.trim();
    if (!title || title === item.title) return;
    try {
      const detail = await renameSavedInvestigation(item.id, title);
      setItems((current) =>
        current.map((candidate) => (candidate.id === item.id ? detail.summary : candidate)),
      );
    } catch {
      setState("error");
    }
  }

  async function remove(item: SavedInvestigationSummary) {
    if (!window.confirm(`Delete “${item.title}” and revoke its share links?`)) return;
    try {
      await deleteSavedInvestigation(item.id);
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    } catch {
      setState("error");
    }
  }

  return (
    <section className="saved-library section-shell">
      <div className="saved-library__heading">
        <div>
          <p className="eyebrow">
            <span /> D1 investigation history
          </p>
          <h1>Saved investigations</h1>
          <p>Versioned evidence snapshots owned by this browser installation—not a user account.</p>
        </div>
        <Database size={30} />
      </div>
      <form
        className="saved-library__filters panel"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <label>
          Hostname
          <input
            value={hostname}
            onChange={(event) => setHostname(event.target.value)}
            placeholder="example.com"
          />
        </label>
        <label>
          Source
          <select value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
            <option value="">All</option>
            <option value="live">Live</option>
            <option value="recorded">Recorded</option>
          </select>
        </label>
        <button className="button button--secondary" type="submit">
          Apply filters
        </button>
      </form>
      {state === "loading" && !items.length ? (
        <div className="saved-library__state">
          <LoaderCircle className="spin" /> Loading saved investigations…
        </div>
      ) : state === "error" ? (
        <div className="saved-library__state" role="alert">
          <AlertTriangle /> Saved investigations are unavailable. Check the D1 migration and Worker
          binding.
        </div>
      ) : !items.length ? (
        <div className="saved-library__state">
          <Database />
          <strong>No saved investigations yet</strong>
          <span>Open a live or recorded journey and choose Save.</span>
          <Link className="button button--primary" to="/explore">
            Explore examples
          </Link>
        </div>
      ) : (
        <div className="saved-library__grid">
          {items.map((item) => (
            <article className="saved-card panel" key={item.id}>
              <div className="saved-card__meta">
                <span>{item.sourceType}</span>
                <span>{item.status}</span>
                <time>{new Date(item.savedAt).toLocaleDateString()}</time>
              </div>
              <h2>
                <Link to={`/saved/${item.id}`}>{item.title}</Link>
              </h2>
              <p>{item.hostname}</p>
              <div className="saved-card__findings">
                <b>{item.findingCounts.high} high</b>
                <span>{item.findingCounts.medium} medium</span>
                <span>{item.findingCounts.low} low</span>
              </div>
              <small>
                {item.hasAiDiagnosis ? "AI diagnosis · " : ""}
                {item.hasCounterfactual ? "Simulation · " : ""}
                {item.hasScreenshot ? "Screenshot" : "Evidence snapshot"}
              </small>
              <div className="saved-card__actions">
                <Link to={`/saved/${item.id}`}>
                  <ExternalLink size={13} /> Open
                </Link>
                <button type="button" onClick={() => void rename(item)}>
                  <Pencil size={13} /> Rename
                </button>
                <button type="button" onClick={() => void remove(item)}>
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {nextCursor ? (
        <button
          className="button button--secondary"
          type="button"
          disabled={state === "loading"}
          onClick={() => void load(nextCursor, true)}
        >
          Load more
        </button>
      ) : null}
    </section>
  );
}
