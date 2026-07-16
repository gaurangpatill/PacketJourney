import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./AppShell";
import { ExplorePage } from "./pages/ExplorePage";
import { InvestigationPage } from "./pages/InvestigationPage";
import { LandingPage } from "./pages/LandingPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { NotFoundPage } from "./pages/NotFoundPage";

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<LandingPage />} />
        <Route path="explore" element={<ExplorePage />} />
        <Route path="investigate" element={<InvestigationPage />} />
        <Route path="investigations/:investigationId" element={<InvestigationPage />} />
        <Route
          path="investigations"
          element={
            <PlaceholderPage
              eyebrow="Investigation library"
              title="Your investigations, organized."
              copy="Saved investigations arrive with the persistence milestone. Explore a seeded journey now to see the complete workspace shape."
            />
          }
        />
        <Route
          path="saved"
          element={
            <PlaceholderPage
              eyebrow="Saved journeys"
              title="Nothing saved yet."
              copy="Shareable links, history, and team ownership are planned for Layer 9 and are not represented as active features today."
            />
          }
        />
        <Route
          path="docs"
          element={
            <PlaceholderPage
              eyebrow="Documentation"
              title="Evidence before explanation."
              copy="Packet Journey's protocol, security, and AI design documents live with the source while the in-product documentation experience is built."
            />
          }
        />
        <Route path="home" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
