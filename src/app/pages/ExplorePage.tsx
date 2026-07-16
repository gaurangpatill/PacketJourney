import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { investigations } from "../../data/investigations";

export function ExplorePage() {
  return (
    <section className="page-section section-shell">
      <div className="page-heading">
        <p className="eyebrow">
          <span /> Seeded investigations
        </p>
        <h1>Every path tells a different story.</h1>
        <p>
          Stable, recorded scenarios demonstrate the journey model without depending on
          unpredictable external websites.
        </p>
      </div>
      <div className="scenario-grid">
        {investigations.map((item, index) => (
          <Link className="scenario-card" to={`/investigations/${item.id}`} key={item.id}>
            <div className="scenario-card__top">
              <span>0{index + 1}</span>
              <ArrowUpRight size={18} />
            </div>
            <div className="scenario-card__path" aria-hidden="true">
              {item.stages.slice(0, 7).map((stage) => (
                <i className={`is-${stage.status}`} key={stage.id} />
              ))}
            </div>
            <h2>{item.title}</h2>
            <p>{item.summary}</p>
            <dl>
              <div>
                <dt>Duration</dt>
                <dd>{item.metrics.totalDurationMs} ms</dd>
              </div>
              <div>
                <dt>Stages</dt>
                <dd>{item.stages.length}</dd>
              </div>
              <div>
                <dt>Findings</dt>
                <dd>{item.findings.length}</dd>
              </div>
            </dl>
          </Link>
        ))}
      </div>
    </section>
  );
}
