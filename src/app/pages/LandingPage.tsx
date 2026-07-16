import { ArrowRight, Braces, Gauge, ScanSearch, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { UrlInvestigationForm } from "../../components/UrlInvestigationForm";
import { investigations } from "../../data/investigations";
import { JourneyPreview } from "../../features/investigation/JourneyPreview";

const capabilities = [
  {
    icon: ScanSearch,
    number: "01",
    title: "Reconstruct the request",
    copy: "Follow the real sequence across DNS, TLS, redirects, edge cache, origin, and browser rendering.",
  },
  {
    icon: Sparkles,
    number: "02",
    title: "Investigate with evidence",
    copy: "Ask why something happened. Every conclusion points back to collected protocol evidence.",
  },
  {
    icon: Braces,
    number: "03",
    title: "See the browser's work",
    copy: "Uncover render-blocking resources, failed requests, and the services hiding behind third-party domains.",
  },
  {
    icon: Gauge,
    number: "04",
    title: "Test a different journey",
    copy: "Simulate edge caching, fewer redirects, or a faster origin without confusing projections with measurements.",
  },
];

export function LandingPage() {
  const heroInvestigation = investigations[0]!;

  return (
    <>
      <section className="hero section-shell">
        <div className="hero__ambient" aria-hidden="true" />
        <div className="hero__copy">
          <p className="eyebrow">
            <span /> Network investigation, reconstructed
          </p>
          <h1>
            See what really happens after you press <em>Enter.</em>
          </h1>
          <p className="hero__lede">
            Packet Journey reconstructs the path from DNS resolution to browser rendering, then
            surfaces bottlenecks, security issues, caching problems, and hidden dependencies.
          </p>
          <UrlInvestigationForm />
          <div className="hero__actions">
            <Link to="/investigations/fast-cached">
              Watch an example journey <ArrowRight size={15} />
            </Link>
            <span>
              <i /> Layer 1 · Recorded evidence
            </span>
          </div>
        </div>
        <div className="hero-visual" aria-label="Example request journey">
          <div className="hero-visual__topline">
            <span>
              <i /> Live journey preview
            </span>
            <code>www.cloudflare.com</code>
          </div>
          <JourneyPreview investigation={heroInvestigation} compact />
          <div className="signal-card">
            <div>
              <span>EDGE STATUS</span>
              <strong>Cache hit</strong>
            </div>
            <div>
              <span>ORIGIN TRIPS</span>
              <strong>0</strong>
            </div>
            <div>
              <span>FIRST PAINT</span>
              <strong>243 ms</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="trust-strip" aria-label="Investigation layers">
        <div className="section-shell">
          <span>DNS</span>
          <i /> <span>TLS 1.3</span>
          <i /> <span>HTTP/2 + HTTP/3</span>
          <i /> <span>EDGE CACHE</span>
          <i /> <span>BROWSER RENDER</span>
        </div>
      </section>

      <section className="capabilities section-shell">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              <span /> One request, every layer
            </p>
            <h2>A system view—not another waterfall.</h2>
          </div>
          <p>
            Packet Journey connects protocol facts into a single navigable path, so you can
            understand the sequence and the consequence.
          </p>
        </div>
        <div className="capability-grid">
          {capabilities.map(({ icon: Icon, number, title, copy }) => (
            <article className="capability-card" key={number}>
              <span className="capability-card__number">{number}</span>
              <Icon size={20} />
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="demo-section section-shell">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              <span /> Recorded scenarios
            </p>
            <h2>Explore a journey with known evidence.</h2>
          </div>
          <Link className="text-link" to="/explore">
            View all scenarios <ArrowRight size={15} />
          </Link>
        </div>
        <div className="demo-grid">
          {investigations.slice(0, 3).map((item) => (
            <Link className="demo-card" to={`/investigations/${item.id}`} key={item.id}>
              <div className="demo-card__meta">
                <span className={`status-dot status-dot--${item.status}`} /> {item.stages.length}{" "}
                stages <b>{item.metrics.totalDurationMs} ms</b>
              </div>
              <h3>{item.title}</h3>
              <p>{item.summary}</p>
              <span className="text-link">
                Open investigation <ArrowRight size={14} />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="principle-section section-shell">
        <div>
          <p className="eyebrow">
            <span /> The operating principle
          </p>
          <h2>
            Facts first.
            <br />
            Interpretation second.
          </h2>
        </div>
        <blockquote>
          “Deterministic code collects and verifies facts. AI selects tools, connects evidence,
          ranks findings, and explains the result.”
        </blockquote>
      </section>
    </>
  );
}
