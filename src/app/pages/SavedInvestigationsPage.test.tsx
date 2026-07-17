import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SavedInvestigationsPage } from "./SavedInvestigationsPage";

const { listSavedInvestigations } = vi.hoisted(() => ({
  listSavedInvestigations: vi.fn(),
}));
vi.mock("../../features/persistence/api", () => ({
  listSavedInvestigations,
  renameSavedInvestigation: vi.fn(),
  deleteSavedInvestigation: vi.fn(),
}));

describe("SavedInvestigationsPage", () => {
  beforeEach(() => listSavedInvestigations.mockReset());

  it("renders an honest anonymous-history empty state", async () => {
    listSavedInvestigations.mockResolvedValue({ items: [] });
    render(
      <MemoryRouter>
        <SavedInvestigationsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("No saved investigations yet")).toBeInTheDocument();
    expect(screen.getByText(/not a user account/i)).toBeInTheDocument();
  });
});
