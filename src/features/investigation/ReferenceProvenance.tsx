import { BookOpen, ExternalLink, FileCheck2 } from "lucide-react";
import type { AiDiagnosis } from "./aiSchema";

const publisherLabel: Record<string, string> = {
  cloudflare: "Cloudflare Developers",
  ietf: "IETF / RFC Editor",
  mdn: "MDN Web Docs",
  owasp: "OWASP",
  "web-dev": "web.dev",
  "cab-forum": "CA/Browser Forum",
};

export function ReferenceProvenance({ diagnosis }: { diagnosis: AiDiagnosis }) {
  const metadata = diagnosis.retrievalMetadata;
  return (
    <section className="reference-provenance" aria-labelledby={`references-${diagnosis.id}`}>
      <div className="reference-provenance__heading">
        <div>
          <span className="panel-kicker">TECHNICAL REFERENCES</span>
          <h3 id={`references-${diagnosis.id}`}>Authoritative context</h3>
        </div>
        <span className={`reference-status reference-status--${metadata?.status ?? "none"}`}>
          <BookOpen size={13} />
          {metadata?.status === "fixture"
            ? "LOCAL FIXTURE"
            : metadata?.status === "success"
              ? `${diagnosis.referenceCitations.length} VALIDATED`
              : metadata?.status === "no-result"
                ? "NO RELEVANT PASSAGE"
                : metadata?.status === "unavailable"
                  ? "UNAVAILABLE"
                  : "EVIDENCE ONLY"}
        </span>
      </div>
      {diagnosis.referenceCitations.length ? (
        <div className="reference-cards">
          {diagnosis.referenceCitations.map((citation) => (
            <article key={citation.citationId} className="reference-card">
              <header>
                <span>{publisherLabel[citation.publisher] ?? citation.publisher}</span>
                <code>{citation.citationId}</code>
              </header>
              <h4>{citation.title}</h4>
              <strong>{citation.heading}</strong>
              <p>{citation.excerpt}</p>
              <footer>
                <span>{citation.selectionReason}</span>
                <a href={citation.canonicalUrl} target="_blank" rel="noreferrer">
                  Open source <ExternalLink size={12} />
                </a>
              </footer>
              <small>
                Reference snapshot · retrieved{" "}
                {new Date(citation.sourceRetrievedAt).toLocaleDateString()}
                {citation.sourceVersion ? ` · ${citation.sourceVersion}` : ""}
              </small>
            </article>
          ))}
        </div>
      ) : (
        <p className="reference-empty">
          {metadata?.status === "unavailable"
            ? "Authoritative retrieval was unavailable. The diagnosis remains grounded in investigation evidence only."
            : metadata?.status === "no-result"
              ? "No allowlisted passage cleared the relevance and validation thresholds."
              : "This explanation did not request external technical references."}
        </p>
      )}
      {metadata ? (
        <details className="provenance-details">
          <summary>
            <FileCheck2 size={13} /> Explanation provenance
          </summary>
          <dl>
            <div>
              <dt>AI model</dt>
              <dd>{diagnosis.model}</dd>
            </div>
            <div>
              <dt>Embedding</dt>
              <dd>
                {metadata.embeddingModel} · {metadata.dimensions}d
              </dd>
            </div>
            <div>
              <dt>Retrieval</dt>
              <dd>{metadata.retrievalVersion}</dd>
            </div>
            <div>
              <dt>Vector index</dt>
              <dd>{metadata.indexVersion}</dd>
            </div>
            <div>
              <dt>Corpus</dt>
              <dd>{metadata.corpusVersion}</dd>
            </div>
            <div>
              <dt>Prompt</dt>
              <dd>{diagnosis.promptVersion}</dd>
            </div>
          </dl>
        </details>
      ) : null}
    </section>
  );
}
