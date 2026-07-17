import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { investigations } from "../../data/investigations";
import { BrowserEvidencePanels } from "./BrowserEvidencePanels";
import type { Investigation } from "./schema";

function browserInvestigation(): Investigation {
  const timestamp = "2026-07-17T12:00:00.000Z";
  return {
    ...investigations[0]!,
    id: "browser-ui",
    scenario: "live-http",
    mock: false,
    stages: [
      ...investigations[0]!.stages,
      {
        id: "browser-investigation",
        type: "browser",
        title: "Browser navigation and rendering",
        shortTitle: "Browser render",
        description: "Fixture browser evidence.",
        status: "success",
        completedAt: timestamp,
        evidence: [
          {
            id: "browser-resources",
            label: "Browser resources",
            value: [
              {
                id: "app",
                url: "https://example.com/app.js",
                hostname: "example.com",
                type: "script",
                status: 200,
                transferSize: 20_000,
                startTimeMs: 100,
                durationMs: 80,
                firstParty: true,
                failed: false,
              },
              {
                id: "analytics",
                url: "https://analytics.example.net/collect",
                hostname: "analytics.example.net",
                type: "fetch",
                status: 204,
                transferSize: 1_000,
                startTimeMs: 220,
                durationMs: 40,
                firstParty: false,
                failed: false,
              },
              {
                id: "failed",
                url: "https://cdn.example.net/missing.css",
                hostname: "cdn.example.net",
                type: "stylesheet",
                startTimeMs: 120,
                durationMs: 25,
                firstParty: false,
                failed: true,
              },
            ],
            source: "Fixture Browser Run evidence",
            collectedAt: timestamp,
            confidence: "verified",
          },
        ],
        connections: [],
        branch: 0,
      },
    ],
    artifacts: [
      {
        id: "123e4567-e89b-42d3-a456-426614174000",
        type: "screenshot",
        label: "Rendered page screenshot",
        storage: "r2",
        contentType: "image/jpeg",
        access: "worker-mediated",
        expiresAt: "2026-07-18T12:00:00.000Z",
        url: "/api/v1/artifacts/screenshots/123e4567-e89b-42d3-a456-426614174000",
      },
    ],
  };
}

describe("browser evidence panels", () => {
  it("renders protected screenshot metadata and a searchable resource waterfall", async () => {
    const user = userEvent.setup();
    render(<BrowserEvidencePanels investigation={browserInvestigation()} />);

    expect(screen.getByRole("heading", { name: "Captured browser viewport" })).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/api/v1/artifacts/screenshots/123e4567-e89b-42d3-a456-426614174000",
    );
    const region = screen.getByRole("region", { name: "Resource timing table" });
    expect(within(region).getByText("example.com")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Resource scope" }), "failed");
    expect(within(region).getByText("cdn.example.net")).toBeInTheDocument();
    expect(within(region).queryByText("example.com")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Resource scope" }), "all");
    await user.type(screen.getByRole("textbox", { name: "Search browser resources" }), "analytics");
    expect(within(region).getByText("analytics.example.net")).toBeInTheDocument();
    expect(within(region).queryByText("cdn.example.net")).not.toBeInTheDocument();
  });

  it("shows a deliberate failure state instead of a broken image", () => {
    render(<BrowserEvidencePanels investigation={browserInvestigation()} />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByText("Screenshot retrieval failed")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("does not render browser panels for an unavailable browser stage", () => {
    const investigation = browserInvestigation();
    investigation.stages = investigation.stages.map((stage) =>
      stage.id === "browser-investigation"
        ? {
            ...stage,
            title: "Browser investigation unavailable",
            status: "warning",
            evidence: [],
          }
        : stage,
    );
    investigation.artifacts = [];
    render(<BrowserEvidencePanels investigation={investigation} />);
    expect(screen.queryByRole("heading", { name: "Captured browser viewport" })).toBeNull();
  });
});
