import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { investigationById } from "../../data/investigations";
import { InvestigationWorkspace } from "../investigation/InvestigationWorkspace";

function renderWorkspace(id = "redirect-chain") {
  return render(
    <MemoryRouter>
      <InvestigationWorkspace investigation={investigationById.get(id)!} />
    </MemoryRouter>,
  );
}

describe("journey workspace integration", () => {
  it("synchronizes graph selection with evidence inspector", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    const canvas = screen.getByTestId("journey-canvas");
    await user.click(
      within(canvas).getByRole("button", { name: /Canonical host.*warning stage/i }),
    );
    const inspector = screen.getByRole("complementary", { name: "Evidence inspector" });
    expect(within(inspector).getByRole("heading", { name: "Canonical host" })).toBeInTheDocument();
    expect(within(inspector).getByText("https://www.example.com/shop")).toBeInTheDocument();
    expect(within(inspector).getAllByText("Recorded diagnostic fixture")).toHaveLength(2);
  });

  it("shows relationship evidence when an edge is selected", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    const redirectEdge = screen.getByRole("button", {
      name: /302 redirect: Destination: https:\/\/www\.example\.com\/shop/i,
    });
    await user.click(redirectEdge);
    const inspector = screen.getByRole("complementary", { name: "Evidence inspector" });
    expect(within(inspector).getByRole("heading", { name: "302 redirect" })).toBeInTheDocument();
    expect(within(inspector).getByText("redirect relationship")).toBeInTheDocument();
  });

  it("keeps graph structure stable while expertise presentation changes", async () => {
    const user = userEvent.setup();
    renderWorkspace("fast-cached");
    const graph = screen.getByRole("group", { name: "Interactive request journey graph" });
    const before = within(graph).getAllByRole("button").length;
    await user.selectOptions(screen.getByRole("combobox", { name: "Expertise mode" }), "beginner");
    expect(
      within(graph).getByRole("button", { name: /Your browser.*success stage/i }),
    ).toBeInTheDocument();
    expect(within(graph).getAllByRole("button")).toHaveLength(before);
  });

  it("selects and reveals a stage from the timeline", async () => {
    const user = userEvent.setup();
    renderWorkspace("slow-origin");
    await user.click(screen.getByRole("listitem", { name: "Go to Application origin" }));
    const origin = screen.getByRole("button", {
      name: /Origin.*warning stage.*1462 milliseconds/i,
    });
    expect(origin).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Measured bottleneck")).toBeInTheDocument();
  });
});
