import { ArrowRight, CircleDashed } from "lucide-react";
import { Link } from "react-router-dom";

type PlaceholderPageProps = { eyebrow: string; title: string; copy: string };

export function PlaceholderPage({ eyebrow, title, copy }: PlaceholderPageProps) {
  return (
    <section className="centered-state section-shell">
      <CircleDashed size={30} aria-hidden="true" />
      <p className="eyebrow">
        <span /> {eyebrow}
      </p>
      <h1>{title}</h1>
      <p>{copy}</p>
      <Link className="button button--secondary" to="/explore">
        Explore recorded journeys <ArrowRight size={16} />
      </Link>
    </section>
  );
}
