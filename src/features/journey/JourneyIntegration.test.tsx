import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { investigationById } from "../../data/investigations";
import { InvestigationWorkspace } from "../investigation/InvestigationWorkspace";

function renderWorkspace(id = "redirect-chain") {
  return render(
    <MemoryRouter>
      <InvestigationWorkspace investigation={investigationById.get(id)!} />
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("journey workspace integration", () => {
  it("places the assistant and evidence inspector beside the journey in one workspace", () => {
    renderWorkspace("fast-cached");
    const primary = screen.getByRole("region", { name: "Investigation journey workspace" });
    expect(within(primary).getByTestId("journey-canvas")).toBeInTheDocument();
    expect(
      within(primary).getByRole("complementary", { name: "Investigation assistant" }),
    ).toBeInTheDocument();
    expect(
      within(primary).getByRole("complementary", { name: "Evidence inspector" }),
    ).toBeInTheDocument();
  });

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

  it("exposes collection timestamps in network-engineer mode", async () => {
    const user = userEvent.setup();
    renderWorkspace("fast-cached");
    await user.selectOptions(screen.getByRole("combobox", { name: "Expertise mode" }), "engineer");
    const canvas = screen.getByTestId("journey-canvas");
    await user.click(
      within(canvas).getByRole("button", { name: /^DNS resolution.*success stage/i }),
    );
    const inspector = screen.getByRole("complementary", { name: "Evidence inspector" });
    expect(within(inspector).getAllByText("2026-07-16T04:15:12.000Z")).toHaveLength(2);
    expect(within(inspector).getAllByText("Recorded diagnostic fixture")).toHaveLength(2);
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

  it("applies validated AI emphasis and navigates to cited evidence", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            diagnosis: {
              id: "diagnosis-graph",
              question: "What is the likely bottleneck?",
              summary: "Origin wait is the largest measured stage.",
              answer:
                "The origin stage has the dominant recorded duration, without revealing its internal cause.",
              confidence: 0.8,
              conclusionType: "supported",
              relatedFindings: [],
              prioritizedActions: [],
              evidenceReferences: [
                {
                  evidenceId: "origin-e1",
                  stageId: "origin",
                  claim: "The investigation records a 1.46 second origin wait.",
                },
              ],
              uncertainties: [
                {
                  statement: "The internal cause is unknown.",
                  reason: "The investigation cannot observe application internals.",
                },
              ],
              followUpQuestions: [],
              graphInstructions: {
                emphasizeStageIds: ["origin"],
                emphasizeEvidenceIds: ["origin-e1"],
                dimStageIds: [],
                selectedStageId: "origin",
                openPanel: "evidence",
              },
              generatedAt: "2026-07-17T16:00:00.000Z",
              model: "fixture:llama-3.3-70b-fast",
              promptVersion: "packet-journey-ai-v1",
              source: "fixture",
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      ),
    );
    renderWorkspace("slow-origin");
    await user.type(
      screen.getByLabelText("Ask about this investigation"),
      "What is the likely bottleneck?",
    );
    await user.click(screen.getByRole("button", { name: "Submit question" }));
    expect(
      await screen.findByText("Origin wait is the largest measured stage."),
    ).toBeInTheDocument();
    const origin = screen.getByRole("button", { name: /Origin.*warning stage/i });
    expect(origin).toHaveClass("is-ai-emphasized");
    expect(origin).toHaveAttribute("aria-pressed", "true");
    expect(
      within(screen.getByRole("complementary", { name: "Evidence inspector" })).getByText("1.46 s"),
    ).toBeInTheDocument();
  });
});
