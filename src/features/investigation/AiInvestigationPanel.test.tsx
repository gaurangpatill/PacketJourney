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
    const request = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(typeof request?.body).toBe("string");
    expect(JSON.parse(request?.body as string)).toMatchObject({ referenceMode: "authoritative" });
    expect(await screen.findByText(/not sufficient for a reliable diagnosis/i)).toBeInTheDocument();
    expect(screen.getByText(/inconclusive · 20% confidence/i)).toBeInTheDocument();
  });

  it("lets keyboard users choose evidence-only mode", async () => {
    const user = userEvent.setup();
    const investigation = investigationById.get("fast-cached")!;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            diagnosis: {
              ...inconclusiveDraft("Evidence only."),
              id: "diagnosis-2",
              question: "Explain this evidence",
              generatedAt: "2026-07-17T12:00:00.000Z",
              model: "fixture",
              promptVersion: "packet-journey-ai-v1",
              source: "fixture",
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
    await user.click(screen.getByRole("button", { name: "Evidence only" }));
    await user.type(screen.getByLabelText("Ask about this investigation"), "Explain this evidence");
    await user.click(screen.getByRole("button", { name: "Submit question" }));
    const body = vi.mocked(fetch).mock.calls[0]?.[1]?.body;
    expect(typeof body).toBe("string");
    expect(JSON.parse(body as string)).toMatchObject({
      referenceMode: "none",
    });
    expect((await screen.findAllByText("Evidence only.")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Evidence only" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("keeps a conversation transcript across multiple questions", async () => {
    const user = userEvent.setup();
    const investigation = investigationById.get("fast-cached")!;
    let request = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        request += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              diagnosis: {
                ...inconclusiveDraft(
                  request === 1 ? "First grounded answer." : "Second grounded answer.",
                ),
                id: `diagnosis-${request}`,
                question: request === 1 ? "What website is this?" : "What was cached?",
                generatedAt: "2026-07-17T12:00:00.000Z",
                model: "deterministic-evidence-guard",
                promptVersion: "packet-journey-ai-v1",
                source: "evidence-guard",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }),
    );

    render(
      <AiInvestigationPanel
        investigation={investigation}
        expertise="developer"
        onDiagnosis={() => undefined}
        onEvidenceReference={() => undefined}
      />,
    );

    const composer = screen.getByLabelText("Ask about this investigation");
    await user.type(composer, "What website is this?");
    await user.click(screen.getByRole("button", { name: "Submit question" }));
    expect((await screen.findAllByText("First grounded answer.")).length).toBeGreaterThan(0);
    await user.clear(composer);
    await user.type(composer, "What was cached?");
    await user.click(screen.getByRole("button", { name: "Submit question" }));
    expect((await screen.findAllByText("Second grounded answer.")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("First grounded answer.").length).toBeGreaterThan(0);
    expect(screen.getByText("What website is this?")).toBeInTheDocument();
    expect(screen.getByText("What was cached?")).toBeInTheDocument();
  });
});
