import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { investigationById } from "../../data/investigations";
import { SaveInvestigationDialog } from "./SaveInvestigationDialog";

describe("SaveInvestigationDialog", () => {
  it("explains snapshot ownership and disables absent optional results", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SaveInvestigationDialog
        investigation={investigationById.get("fast-cached")!}
        expertiseMode="developer"
        onClose={onClose}
      />,
    );
    expect(screen.getByRole("dialog", { name: /save this investigation/i })).toBeInTheDocument();
    expect(screen.getByText(/not an account/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/selected AI diagnosis/i)).toBeDisabled();
    expect(screen.getByLabelText(/selected deterministic simulation/i)).toBeDisabled();
    const title = screen.getByLabelText("Title");
    await user.clear(title);
    expect(screen.getByRole("button", { name: /save investigation/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /close save dialog/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
