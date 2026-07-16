import { Outlet } from "react-router-dom";
import { SiteHeader } from "../components/SiteHeader";

export function AppShell() {
  return (
    <div className="app-shell">
      <SiteHeader />
      <main id="main-content">
        <Outlet />
      </main>
    </div>
  );
}
