import { ExternalLink, ImageOff, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { artifactUrl } from "./api";
import type { Investigation } from "./schema";

type ResourceView = {
  id: string;
  url: string;
  hostname: string;
  type: string;
  status?: number;
  transferSize?: number;
  startTimeMs?: number;
  durationMs?: number;
  firstParty: boolean;
  failed: boolean;
};

function resourceViews(investigation: Investigation): ResourceView[] {
  const item = investigation.stages
    .flatMap((stage) => stage.evidence)
    .find((evidence) => evidence.label === "Browser resources");
  if (!Array.isArray(item?.value)) return [];
  return item.value.flatMap((value): ResourceView[] => {
    if (!value || typeof value !== "object") return [];
    const resource = value as Record<string, unknown>;
    if (
      typeof resource.id !== "string" ||
      typeof resource.url !== "string" ||
      typeof resource.hostname !== "string" ||
      typeof resource.type !== "string" ||
      typeof resource.firstParty !== "boolean" ||
      typeof resource.failed !== "boolean"
    ) {
      return [];
    }
    return [
      {
        id: resource.id,
        url: resource.url,
        hostname: resource.hostname,
        type: resource.type,
        firstParty: resource.firstParty,
        failed: resource.failed,
        ...(typeof resource.status === "number" ? { status: resource.status } : {}),
        ...(typeof resource.transferSize === "number"
          ? { transferSize: resource.transferSize }
          : {}),
        ...(typeof resource.startTimeMs === "number" ? { startTimeMs: resource.startTimeMs } : {}),
        ...(typeof resource.durationMs === "number" ? { durationMs: resource.durationMs } : {}),
      },
    ];
  });
}

function ScreenshotPanel({ investigation }: { investigation: Investigation }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const screenshot = investigation.artifacts.find((artifact) => artifact.type === "screenshot");
  const src = screenshot?.url ? artifactUrl(screenshot.url) : undefined;
  return (
    <section className="browser-screenshot panel" aria-labelledby="browser-screenshot-title">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">RENDERED PAGE</p>
          <h2 id="browser-screenshot-title">Captured browser viewport</h2>
        </div>
        {src && !failed ? (
          <a href={src} target="_blank" rel="noreferrer" aria-label="Open screenshot full size">
            <ExternalLink size={15} />
          </a>
        ) : null}
      </div>
      <div className="browser-screenshot__viewport">
        {!src || failed ? (
          <div className="browser-artifact-empty">
            <ImageOff size={24} />
            <strong>{failed ? "Screenshot retrieval failed" : "No screenshot artifact"}</strong>
            <span>
              {failed
                ? "The private artifact may have expired or become unavailable."
                : "Browser evidence may still be available without an image."}
            </span>
          </div>
        ) : (
          <>
            {!loaded ? (
              <div className="browser-screenshot__loading">Loading private artifact…</div>
            ) : null}
            <img
              className={loaded ? "" : "is-loading"}
              src={src}
              alt={"Rendered public page captured for " + investigation.normalizedUrl}
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
            />
          </>
        )}
      </div>
      <p>
        Captured during browser investigation · one unauthenticated lab session · expires{" "}
        {screenshot?.expiresAt ? new Date(screenshot.expiresAt).toLocaleString() : "per policy"}
      </p>
    </section>
  );
}

function ResourceWaterfall({ investigation }: { investigation: Investigation }) {
  const resources = useMemo(() => resourceViews(investigation), [investigation]);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "failed" | "third-party">("all");
  const [sort, setSort] = useState<"start" | "duration" | "size">("start");
  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return resources
      .filter((resource) => {
        if (scope === "failed" && !resource.failed) return false;
        if (scope === "third-party" && resource.firstParty) return false;
        return (
          !normalizedQuery ||
          resource.hostname.toLowerCase().includes(normalizedQuery) ||
          resource.url.toLowerCase().includes(normalizedQuery)
        );
      })
      .sort((left, right) => {
        if (sort === "duration") return (right.durationMs ?? 0) - (left.durationMs ?? 0);
        if (sort === "size") return (right.transferSize ?? 0) - (left.transferSize ?? 0);
        return (
          (left.startTimeMs ?? Number.MAX_SAFE_INTEGER) -
          (right.startTimeMs ?? Number.MAX_SAFE_INTEGER)
        );
      });
  }, [query, resources, scope, sort]);
  const maximumEnd = Math.max(
    1,
    ...resources.map((resource) => (resource.startTimeMs ?? 0) + (resource.durationMs ?? 0)),
  );

  return (
    <section className="resource-waterfall panel" aria-labelledby="resource-waterfall-title">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">BROWSER RESOURCES</p>
          <h2 id="resource-waterfall-title">Bounded resource waterfall</h2>
        </div>
        <span>{resources.length} retained</span>
      </div>
      <div className="resource-waterfall__controls">
        <label>
          <Search size={13} />
          <span className="sr-only">Search browser resources</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search domain or resource"
          />
        </label>
        <select
          value={scope}
          onChange={(event) => setScope(event.target.value as typeof scope)}
          aria-label="Resource scope"
        >
          <option value="all">All requests</option>
          <option value="failed">Failed</option>
          <option value="third-party">Third party</option>
        </select>
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as typeof sort)}
          aria-label="Resource sort order"
        >
          <option value="start">Start time</option>
          <option value="duration">Duration</option>
          <option value="size">Transfer size</option>
        </select>
      </div>
      <div
        className="resource-waterfall__table"
        role="region"
        aria-label="Resource timing table"
        tabIndex={0}
      >
        {visible.length === 0 ? (
          <p className="muted-empty">No browser resources match the current filter.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Resource</th>
                <th>Type</th>
                <th>Status</th>
                <th>Size</th>
                <th>Timing</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((resource) => {
                const left = ((resource.startTimeMs ?? 0) / maximumEnd) * 100;
                const width = Math.max(1.5, ((resource.durationMs ?? 0) / maximumEnd) * 100);
                return (
                  <tr key={resource.id} className={resource.failed ? "is-failed" : ""}>
                    <td title={resource.url}>
                      <strong>{resource.hostname}</strong>
                      <span>{resource.firstParty ? "First party" : "Third party"}</span>
                    </td>
                    <td>{resource.type}</td>
                    <td>{resource.failed ? "Failed" : (resource.status ?? "—")}</td>
                    <td>
                      {resource.transferSize === undefined
                        ? "—"
                        : Math.round(resource.transferSize / 1_000) + " kB"}
                    </td>
                    <td>
                      <div
                        className="waterfall-track"
                        aria-label={(resource.durationMs ?? 0) + " milliseconds"}
                      >
                        <i style={{ left: left + "%", width: width + "%" }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

export function BrowserEvidencePanels({ investigation }: { investigation: Investigation }) {
  const browserStage = investigation.stages.find((stage) => stage.id === "browser-investigation");
  const resources = resourceViews(investigation);
  if (
    !browserStage ||
    browserStage.title === "Browser investigation unavailable" ||
    (resources.length === 0 && investigation.artifacts.length === 0)
  ) {
    return null;
  }
  return (
    <div className="browser-evidence-grid">
      <ScreenshotPanel investigation={investigation} />
      <ResourceWaterfall investigation={investigation} />
    </div>
  );
}
