import { describe, expect, it } from "vitest";
import { investigations } from "../../data/investigations";
import { suggestCounterfactuals } from "./suggestions";

describe("counterfactual suggestions", () => {
  it("suggests only scenarios supported by existing evidence", () => {
    const redirects = investigations.find((item) => item.id === "redirect-chain")!;
    const types = suggestCounterfactuals(redirects).map((item) => item.type);
    expect(types).toContain("remove-redirects");
    expect(types).toContain("reduce-origin-latency");
    expect(types).not.toContain("remove-third-party");
  });

  it("does not suggest a second-order simulation", () => {
    const source = structuredClone(investigations[0]!);
    source.simulation = {
      isSimulated: true,
      sourceInvestigationId: source.id,
      scenarioId: "s",
      ruleId: "r",
      engineVersion: "1",
      label: "SIMULATED · NOT MEASURED",
    };
    expect(suggestCounterfactuals(source)).toEqual([]);
  });
});
