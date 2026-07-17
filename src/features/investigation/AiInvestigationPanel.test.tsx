import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { investigationById } from "../../data/investigations";
import { AiInvestigationPanel } from "./AiInvestigationPanel";

function inconclusiveDraft(reason: string) {
  return {
    summary: "The available evidence is not sufficient for a reliable diagnosis.",
    answer: reason,
    confidence: 0.2,
    conclusionType: "inconclusive",
    relatedFindings: [],
    prioritizedActions: [],
    evidenceReferences: [],
    uncertainties: [{ statement: "No supported conclusion is available.", reason }],
    followUpQuestions: [],
    graphInstructions: {
      emphasizeStageIds: [],
      emphasizeEvidenceIds: [],
      dimStageIds: [],
      openPanel: "none",
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("AI investigation panel", () => {
  it("renders a validated inconclusive answer without pretending certainty", async () => {
    const user = userEvent.setup();
    const investigation = investigationById.get("fast-cached")!;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            diagnosis: {
              ...inconclusiveDraft("The investigation did not collect an origin measurement."),
              id: "diagnosis-1",
              question: "Why is this page slow?",
              generatedAt: "2026-07-17T12:00:00.000Z",
              model: "deterministic-evidence-guard",
              promptVersion: "packet-journey-ai-v1",
              source: "evidence-guard",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    render(
      <AiInvestigationPanel
        investigation={investigation}
        expertise="developer"
        onDiagnosis={() => undefined}
        onEvidenceReference={() => undefined}
      />,
    );
    await user.type(
      screen.getByLabelText("Ask about this investigation"),
      "Why is this page slow?",
    );
    await user.click(screen.getByRole("button", { name: "Submit question" }));
    expect(await screen.findByText(/not sufficient for a reliable diagnosis/i)).toBeInTheDocument();
    expect(screen.getByText(/inconclusive · 20% confidence/i)).toBeInTheDocument();
  });
});
