import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "./App";

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
    await user.click(screen.getByRole("button", { name: /Canonical host/i }));
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
});
