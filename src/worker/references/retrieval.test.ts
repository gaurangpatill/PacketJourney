// @vitest-environment node
import { describe, expect, it } from "vitest";
import { investigationById } from "../../data/investigations";
import { REFERENCE_CONFIG } from "../../features/references/config";
import { buildControlledReferenceQuery } from "./queryBuilder";
import {
  FixtureReferenceRetriever,
  UnavailableReferenceRetriever,
  VectorizeReferenceRetriever,
} from "./retrieval";

const investigation = investigationById.get("missing-cache")!;

describe("controlled technical reference retrieval", () => {
  it("builds deterministic sanitized cache filters without leaking query values", () => {
    const result = buildControlledReferenceQuery({
      question: "Why is https://example.com/private?token=secret#frag not cached?",
      investigation,
      expertiseMode: "developer",
    });
    expect(result.filter.categories).toEqual(["caching", "http", "cdn"]);
    expect(result.query).not.toContain("secret");
    expect(result.query).not.toContain("frag");
    expect(result.query).toContain("https://example.com/[path]");
  });

  it("retrieves stable diverse fixture citations within all bounds", async () => {
    const retriever = new FixtureReferenceRetriever();
    const first = await retriever.retrieve({
      question: "Why was this response not cached with Cache-Control private no-store?",
      investigation,
      expertiseMode: "developer",
    });
    const second = await retriever.retrieve({
      question: "Why was this response not cached with Cache-Control private no-store?",
      investigation,
      expertiseMode: "developer",
    });
    expect(first.metadata.status).toBe("fixture");
    expect(first.citations.length).toBeGreaterThan(0);
    expect(first.citations.length).toBeLessThanOrEqual(REFERENCE_CONFIG.maximumSelected);
    expect(first.citations.map((item) => item.referenceChunkId)).toEqual(
      second.citations.map((item) => item.referenceChunkId),
    );
    expect(first.citations.some((item) => item.publisher === "ietf")).toBe(true);
    expect(new Set(first.citations.map((item) => item.contentHash)).size).toBe(
      first.citations.length,
    );
  });

  it("returns explicit unavailability without consulting another source", async () => {
    const result = await new UnavailableReferenceRetriever().retrieve({
      question: "Explain caching",
      investigation,
      expertiseMode: "beginner",
    });
    expect(result.metadata.status).toBe("unavailable");
    expect(result.metadata.errorCode).toBe("binding-unavailable");
    expect(result.citations).toEqual([]);
  });

  it("rejects embedding output with the wrong configured dimensions", async () => {
    const retriever = new VectorizeReferenceRetriever(
      { run: () => Promise.resolve({ data: [[0, 1]] }) },
      { query: () => Promise.resolve({ matches: [] }) },
      {} as D1Database,
    );
    const result = await retriever.retrieve({
      question: "Explain caching",
      investigation,
      expertiseMode: "developer",
    });
    expect(result.metadata.errorCode).toBe("embedding-failed");
  });
});
