import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { InvestigationWorkspaceLayout, type WorkspaceTab } from "./InvestigationWorkspaceLayout";

function LayoutHarness() {
  const [tab, setTab] = useState<WorkspaceTab>("journey");
  return (
    <InvestigationWorkspaceLayout
      mobileTab={tab}
      onMobileTabChange={setTab}
      evidence={<aside aria-label="Test evidence">Evidence content</aside>}
      journey={<main>Journey content</main>}
      assistant={<aside aria-label="Test assistant">Assistant content</aside>}
    />
  );
}

describe("InvestigationWorkspaceLayout", () => {
  it("renders evidence, journey, and assistant as ordered workspace columns", () => {
    render(<LayoutHarness />);
    const workspace = screen.getByRole("region", { name: "Investigation journey workspace" });
    expect(workspace).toHaveClass("investigation-workspace-layout");
    expect(screen.getByText("Evidence content")).toBeInTheDocument();
    expect(screen.getByText("Journey content")).toBeInTheDocument();
    expect(screen.getByText("Assistant content")).toBeInTheDocument();
    expect(workspace.querySelector(".workspace-panel--evidence")).toBe(workspace.firstElementChild);
    expect(workspace.querySelector(".workspace-panel--assistant")).toBe(workspace.lastElementChild);
  });

  it("collapses and restores both persistent sidebars", async () => {
    const user = userEvent.setup();
    render(<LayoutHarness />);
    const workspace = screen.getByRole("region", { name: "Investigation journey workspace" });

    await user.click(screen.getByRole("button", { name: "Collapse evidence inspector" }));
    expect(workspace).toHaveAttribute("data-left-collapsed", "true");
    expect(screen.getByRole("button", { name: "Expand evidence inspector" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    await user.click(screen.getByRole("button", { name: "Collapse evidence assistant" }));
    expect(workspace).toHaveAttribute("data-right-collapsed", "true");
    await user.click(screen.getByRole("button", { name: "Expand evidence assistant" }));
    expect(workspace).toHaveAttribute("data-right-collapsed", "false");
  });

  it("resizes both panels with keyboard and pointer input", async () => {
    const user = userEvent.setup();
    render(<LayoutHarness />);
    const workspace = screen.getByRole("region", { name: "Investigation journey workspace" });
    const left = screen.getByRole("separator", { name: "Resize evidence inspector" });
    const right = screen.getByRole("separator", { name: "Resize evidence assistant" });

    left.focus();
    await user.keyboard("{ArrowRight}");
    expect(left).toHaveAttribute("aria-valuenow", "332");
    expect(workspace.style.getPropertyValue("--workspace-left-width")).toBe("332px");

    const pointer = (type: string, clientX: number) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperties(event, {
        pointerId: { value: 7 },
        clientX: { value: clientX },
      });
      fireEvent(right, event);
    };
    pointer("pointerdown", 800);
    pointer("pointermove", 760);
    pointer("pointerup", 760);
    expect(right).toHaveAttribute("aria-valuenow", "460");
    expect(workspace.style.getPropertyValue("--workspace-right-width")).toBe("460px");
  });

  it("exposes Journey, Evidence, and Assistant as controlled mobile tabs", async () => {
    const user = userEvent.setup();
    render(<LayoutHarness />);
    expect(screen.getByRole("tab", { name: /Journey/i })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: /Assistant/i }));
    expect(screen.getByRole("tab", { name: /Assistant/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(document.querySelector(".workspace-panel--assistant")).toHaveClass("is-mobile-active");
  });
});
