import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { investigations } from "../../data/investigations";
import { CounterfactualWorkspace } from "./CounterfactualWorkspace";

describe("CounterfactualWorkspace", () => {
  it("runs a suggested scenario only after explicit user action", () => {
    render(
      <CounterfactualWorkspace
        investigation={investigations.find((item) => item.id === "slow-origin")!}
        expertise="developer"
      />,
    );
    expect(screen.getByText("No simulation has run")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /run deterministic simulation/i }));
    expect(screen.getAllByText("SIMULATED · NOT MEASURED").length).toBeGreaterThan(0);
    expect(screen.getByText("Synchronized playback")).toBeInTheDocument();
  });

  it("requires confirmation before introducing a failure", () => {
    render(
      <CounterfactualWorkspace
        investigation={investigations.find((item) => item.id === "fast-cached")!}
        expertise="developer"
      />,
    );
    const select = screen.getByLabelText("Scenario");
    fireEvent.change(select, { target: { value: "0" } });
    const option = [...(select as HTMLSelectElement).options].find((item) =>
      item.text.includes("Expire"),
    );
    expect(option).toBeDefined();
    fireEvent.change(select, { target: { value: option!.value } });
    fireEvent.click(screen.getByRole("button", { name: /run deterministic simulation/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/confirm/i);
  });
});
