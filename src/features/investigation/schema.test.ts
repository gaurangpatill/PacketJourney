import { describe, expect, it } from "vitest";
import { investigations } from "../../data/investigations";
import { investigationSchema } from "./schema";

describe("investigationSchema", () => {
  it("validates every seeded investigation", () => {
    for (const investigation of investigations) {
      expect(investigationSchema.safeParse(investigation).success).toBe(true);
    }
  });

  it("rejects stage connections to unknown nodes", () => {
    const source = investigations[0]!;
    const invalid = {
      ...source,
      stages: source.stages.map((stage, index) =>
        index === 0 ? { ...stage, connections: ["missing-stage"] } : stage,
      ),
    };

    expect(investigationSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects findings that cite missing evidence", () => {
    const source = investigations[1]!;
    const invalid = {
      ...source,
      findings: [{ ...source.findings[0]!, evidenceIds: ["invented-evidence"] }],
    };

    expect(investigationSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects duplicate stage and evidence IDs", () => {
    const source = investigations[0]!;
    const duplicateStage = {
      ...source.stages[1]!,
      id: source.stages[0]!.id,
      connections: [],
      evidence: [{ ...source.stages[0]!.evidence[0]! }],
    };
    const invalid = { ...source, stages: [source.stages[0]!, duplicateStage] };
    expect(investigationSchema.safeParse(invalid).success).toBe(false);
  });
});
