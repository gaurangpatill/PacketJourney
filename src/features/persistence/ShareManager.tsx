import { Check, Copy, Link2, LoaderCircle, ShieldOff } from "lucide-react";
import { useEffect, useState } from "react";
import { createShare, listShares, revokeShare } from "./api";
import type { ShareSummary } from "./schema";

export function ShareManager({ investigationId }: { investigationId: string }) {
  const [shares, setShares] = useState<ShareSummary[]>([]);
  const [includeAi, setIncludeAi] = useState(false);
  const [includeCounterfactual, setIncludeCounterfactual] = useState(false);
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const [expires, setExpires] = useState("7");
  const [createdUrl, setCreatedUrl] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void listShares(investigationId)
      .then((response) => setShares(response.shares))
      .catch(() => setError("Existing share links could not be loaded."));
  }, [investigationId]);

  async function create() {
    setBusy(true);
    setError(undefined);
    try {
      const expiresAt = expires
        ? new Date(Date.now() + Number(expires) * 24 * 60 * 60 * 1_000).toISOString()
        : undefined;
      const response = await createShare(investigationId, {
        ...(expiresAt ? { expiresAt } : {}),
        includeAiDiagnosis: includeAi,
        includeCounterfactual,
        includeScreenshot,
      });
      const absolute = new URL(response.path, window.location.origin).toString();
      setCreatedUrl(absolute);
      setShares((current) => [response.share, ...current]);
    } catch {
      setError("A share link could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(shareId: string) {
    setBusy(true);
    try {
      await revokeShare(investigationId, shareId);
      const revokedAt = new Date().toISOString();
      setShares((current) =>
        current.map((share) => (share.id === shareId ? { ...share, revokedAt } : share)),
      );
    } catch {
      setError("The share link could not be revoked.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="share-manager panel" aria-labelledby="share-manager-title">
      <div>
        <p className="panel-kicker">OPAQUE SHARE LINK</p>
        <h2 id="share-manager-title">Share a bounded, read-only projection</h2>
        <p>Only the options selected below are included. The raw token is shown once.</p>
      </div>
      <div className="share-manager__controls">
        <label>
          <input
            type="checkbox"
            checked={includeAi}
            onChange={(event) => setIncludeAi(event.target.checked)}
          />
          Selected AI diagnosis
        </label>
        <label>
          <input
            type="checkbox"
            checked={includeCounterfactual}
            onChange={(event) => setIncludeCounterfactual(event.target.checked)}
          />
          Selected simulation
        </label>
        <label>
          <input
            type="checkbox"
            checked={includeScreenshot}
            onChange={(event) => setIncludeScreenshot(event.target.checked)}
          />
          Saved screenshot
        </label>
        <label>
          Expires
          <select value={expires} onChange={(event) => setExpires(event.target.value)}>
            <option value="1">in 1 day</option>
            <option value="7">in 7 days</option>
            <option value="30">in 30 days</option>
            <option value="">never</option>
          </select>
        </label>
        <button
          className="button button--primary"
          type="button"
          disabled={busy}
          onClick={() => void create()}
        >
          {busy ? <LoaderCircle className="spin" size={14} /> : <Link2 size={14} />} Create link
        </button>
      </div>
      {createdUrl ? (
        <div className="share-manager__created" role="status">
          <code>{createdUrl}</code>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void navigator.clipboard.writeText(createdUrl)}
          >
            <Copy size={13} /> Copy
          </button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {shares.length ? (
        <div className="share-manager__list">
          {shares.map((share) => (
            <div key={share.id}>
              <span>
                {share.revokedAt ? <ShieldOff size={13} /> : <Check size={13} />}
                {share.revokedAt ? "Revoked" : "Active"} · {share.accessCount} accesses · Created{" "}
                {new Date(share.createdAt).toLocaleDateString()}
              </span>
              {!share.revokedAt ? (
                <button type="button" disabled={busy} onClick={() => void revoke(share.id)}>
                  Revoke
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
