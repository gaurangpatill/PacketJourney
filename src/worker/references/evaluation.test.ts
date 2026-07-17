// @vitest-environment node
import { describe, expect, it } from "vitest";
import { investigationById } from "../../data/investigations";
import { retrievalEvaluationCases } from "./evaluation";
import { buildControlledReferenceQuery } from "./queryBuilder";
import { FixtureReferenceRetriever } from "./retrieval";

const investigation = investigationById.get("missing-cache")!;

describe("reference retrieval evaluation fixtures", () => {
  it.each(retrievalEvaluationCases)(
    "$id routes and retrieves an authoritative passage",
    async (fixture) => {
      const query = buildControlledReferenceQuery({
        question: fixture.question,
        investigation,
        expertiseMode: "network-engineer",
      });
      expect(query.filter.categories).toContain(fixture.expectedCategory);
      const result = await new FixtureReferenceRetriever().retrieve({
        question: fixture.question,
        investigation,
        expertiseMode: "network-engineer",
      });
      expect(result.citations.length).toBeGreaterThan(0);
      expect(
        result.citations.some((citation) =>
          fixture.preferredPublishers.includes(citation.publisher),
        ),
      ).toBe(true);
      const text = result.citations.map((citation) => citation.excerpt.toLowerCase()).join(" ");
      expect(fixture.requiredConcepts.some((concept) => text.includes(concept.toLowerCase()))).toBe(
        true,
      );
      for (const forbidden of fixture.forbiddenClaims)
        expect(text).not.toContain(forbidden.toLowerCase());
    },
  );

  it("keeps duplicate rate at zero and publisher diversity bounded", async () => {
    const result = await new FixtureReferenceRetriever().retrieve({
      question: "Explain Cache-Control private no-store and CF-Cache-Status DYNAMIC",
      investigation,
      expertiseMode: "developer",
    });
    expect(new Set(result.citations.map((item) => item.contentHash)).size).toBe(
      result.citations.length,
    );
    expect(new Set(result.citations.map((item) => item.publisher)).size).toBeGreaterThan(1);
  });
});
