import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <section className="centered-state section-shell">
      <code>HTTP 404</code>
      <h1>This route left the network.</h1>
      <p>The page you requested does not exist in this journey.</p>
      <Link className="button button--secondary" to="/">
        <ArrowLeft size={16} /> Return home
      </Link>
    </section>
  );
}
