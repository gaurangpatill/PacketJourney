import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { investigations } from "../data/investigations";
import { App } from "./App";

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderRoute(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>,
  );
}

describe("application routes", () => {
  it("renders the product landing page", () => {
    renderRoute("/");
    expect(
      screen.getByRole("heading", { name: /See what really happens after you press Enter/i }),
    ).toBeInTheDocument();
  });

  it("renders a seeded investigation and changes evidence selection", async () => {
    const user = userEvent.setup();
    renderRoute("/investigations/redirect-chain");

    expect(screen.getByRole("heading", { name: "Multi-hop redirect chain" })).toBeInTheDocument();
    const canvas = screen.getByTestId("journey-canvas");
    await user.click(within(canvas).getByRole("button", { name: /Canonical host/i }));
    expect(screen.getByRole("heading", { name: "Canonical host" })).toBeInTheDocument();
    expect(screen.getByText("https://www.example.com/shop")).toBeInTheDocument();
  });

  it("renders the missing investigation error state", () => {
    renderRoute("/investigations/not-real");
    expect(
      screen.getByRole("heading", { name: "This journey could not be found." }),
    ).toBeInTheDocument();
  });

  it("validates the landing URL field", async () => {
    const user = userEvent.setup();
    renderRoute("/");
    const input = screen.getByRole("textbox", { name: "Public website URL" });
    await user.type(input, "file:///private/data");
    await user.click(screen.getByRole("button", { name: /Start investigation/i }));
    expect(screen.getByRole("alert")).toHaveTextContent("Only HTTP and HTTPS");
  });

  it("loads a live Worker investigation without falling back to a recorded demo", async () => {
    const liveInvestigation = {
      ...investigations[0]!,
      id: "live-app-test",
      title: "Live HTTP journey",
      scenario: "live-http" as const,
      mock: false,
      url: "https://example.com/",
      normalizedUrl: "https://example.com/",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ investigation: liveInvestigation })),
    );

    renderRoute("/investigate?url=https%3A%2F%2Fexample.com%2F");

    expect(await screen.findByRole("heading", { name: "Live HTTP journey" })).toBeInTheDocument();
    expect(screen.getByText("Live network evidence")).toBeInTheDocument();
    expect(screen.queryByText("Recorded example")).not.toBeInTheDocument();
  });

  it("shows a structured non-retryable Worker error and recorded-demo escape route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "blocked_destination",
              message: "The destination resolves to a blocked network range.",
              retryable: false,
            },
          },
          { status: 403 },
        ),
      ),
    );

    renderRoute("/investigate?url=http%3A%2F%2F127.0.0.1%2F");

    expect(
      await screen.findByRole("heading", { name: "The Worker couldn't complete this journey." }),
    ).toBeInTheDocument();
    expect(screen.getByText("blocked_destination")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open recorded demos/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry investigation/i })).not.toBeInTheDocument();
  });
});
