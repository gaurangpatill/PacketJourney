import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./AppShell";
import { ExplorePage } from "./pages/ExplorePage";
import { InvestigationPage } from "./pages/InvestigationPage";
import { LandingPage } from "./pages/LandingPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { SavedInvestigationsPage } from "./pages/SavedInvestigationsPage";
import { SavedInvestigationPage } from "./pages/SavedInvestigationPage";
import { SharedReportPage } from "./pages/SharedReportPage";

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<LandingPage />} />
        <Route path="explore" element={<ExplorePage />} />
        <Route path="investigate" element={<InvestigationPage />} />
        <Route path="investigations/:investigationId" element={<InvestigationPage />} />
        <Route path="investigations" element={<SavedInvestigationsPage />} />
        <Route path="saved" element={<SavedInvestigationsPage />} />
        <Route path="saved/:savedId" element={<SavedInvestigationPage />} />
        <Route path="shared/:token" element={<SharedReportPage />} />
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
