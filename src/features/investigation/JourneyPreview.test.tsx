import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { investigationById } from "../../data/investigations";
import { JourneyPreview } from "./JourneyPreview";

describe("JourneyPreview", () => {
  it.each([
    ["fast-cached", 6],
    ["redirect-chain", 7],
    ["tls-warning", 4],
    ["third-party-heavy", 9],
  ])("renders the %s journey shape", (id, stageCount) => {
    render(<JourneyPreview investigation={investigationById.get(id)!} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(stageCount);
  });

  it("reports stage selection", async () => {
    const user = userEvent.setup();
    const onSelectStage = vi.fn();
    render(
      <JourneyPreview
        investigation={investigationById.get("fast-cached")!}
        onSelectStage={onSelectStage}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Cache/i }));
    expect(onSelectStage).toHaveBeenCalledWith("cache");
  });
});
