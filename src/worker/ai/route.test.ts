// @vitest-environment node
import { describe, expect, it } from "vitest";
import { investigationById } from "../../data/investigations";
import { createRouter } from "../router";
import { diagnoseInvestigationResponseSchema } from "../../features/investigation/aiSchema";
import { FixtureAiClient } from "./fixture";

function diagnosisRequest(id = "fast-cached", referenceMode: "none" | "authoritative" = "none") {
  return new Request(`https://api.example/api/v1/investigations/${id}/diagnose`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      investigation: investigationById.get("fast-cached"),
      question: "What can the evidence support, and what remains unknown?",
      expertiseMode: "developer",
      referenceMode,
    }),
  });
}

function performanceDiagnosisRequest() {
  const investigation = investigationById.get("third-party-heavy")!;
  return new Request(`https://api.example/api/v1/investigations/${investigation.id}/diagnose`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      investigation,
      question: "Review the page performance evidence and prioritize it.",
      expertiseMode: "developer",
      referenceMode: "none",
    }),
  });
}

describe("AI diagnosis route", () => {
  it("returns an explicitly labeled deterministic fixture in test mode", async () => {
    const response = await createRouter()(diagnosisRequest(), {
      ENVIRONMENT: "test",
      AI_FIXTURE_MODE: "true",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      diagnosis: { source: "fixture" },
      usage: { fixture: true },
    });
  });

  it("adds validated local references only when authoritative mode is requested", async () => {
    const response = await createRouter()(diagnosisRequest("fast-cached", "authoritative"), {
      ENVIRONMENT: "test",
      AI_FIXTURE_MODE: "true",
    });
    expect(response.status).toBe(200);
    const payload = diagnoseInvestigationResponseSchema.parse(await response.json());
    const retrieval = payload.diagnosis.retrievalMetadata;
    const technicalReference = payload.diagnosis.technicalReferences[0];
    const citation = payload.diagnosis.referenceCitations[0];
    if (!retrieval || !technicalReference || !citation)
      throw new Error("Missing fixture references");
    expect(retrieval.status).toBe("fixture");
    expect(payload.diagnosis.referenceCitations.length).toBeGreaterThan(0);
    expect(technicalReference.citationId).toBe(citation.citationId);
  });

  it("supports real-AI development with explicitly labeled local reference fixtures", async () => {
    const response = await createRouter({ aiClient: new FixtureAiClient() })(
      diagnosisRequest("fast-cached", "authoritative"),
      {
        ENVIRONMENT: "development",
        AI_FIXTURE_MODE: "false",
        REFERENCE_FIXTURE_MODE: "true",
      },
    );
    expect(response.status).toBe(200);
    const payload = diagnoseInvestigationResponseSchema.parse(await response.json());
    expect(payload.diagnosis.retrievalMetadata?.status).toBe("fixture");
    expect(payload.diagnosis.retrievalMetadata?.fixture).toBe(true);
    expect(payload.diagnosis.referenceCitations.length).toBeGreaterThan(0);
  });

  it("never enables reference fixtures outside development or test", async () => {
    const response = await createRouter({ aiClient: new FixtureAiClient() })(
      diagnosisRequest("fast-cached", "authoritative"),
      {
        ENVIRONMENT: "production",
        REFERENCE_FIXTURE_MODE: "true",
      },
    );
    expect(response.status).toBe(200);
    const payload = diagnoseInvestigationResponseSchema.parse(await response.json());
    expect(payload.diagnosis.retrievalMetadata?.status).toBe("unavailable");
    expect(payload.diagnosis.referenceCitations).toEqual([]);
  });

  it("returns HTTP 200 with deterministic findings when model validation fails", async () => {
    const response = await createRouter({
      aiClient: {
        plan: () => Promise.resolve({ toolCalls: [] }),
        diagnose: () => Promise.resolve({ output: { invalid: true }, rawCharacters: 16 }),
      },
    })(performanceDiagnosisRequest(), {
      ENVIRONMENT: "test",
      AI_FIXTURE_MODE: "false",
    });
    expect(response.status).toBe(200);
    const payload = diagnoseInvestigationResponseSchema.parse(await response.json());
    expect(payload.diagnosis.source).toBe("evidence-guard");
    expect(payload.diagnosis.summary).toMatch(/strongest observed slowdown candidate/i);
    expect(payload.diagnosis.evidenceReferences.length).toBeGreaterThan(0);
  });

  it("rejects a path and payload investigation mismatch", async () => {
    const response = await createRouter()(diagnosisRequest("different"), {
      ENVIRONMENT: "test",
      AI_FIXTURE_MODE: "true",
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_request" } });
  });

  it("fails closed when AI is disabled", async () => {
    const response = await createRouter()(diagnosisRequest(), {
      ENVIRONMENT: "test",
      AI_ENABLED: "false",
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "ai_disabled" } });
  });

  it("fails closed when the production AI binding is missing", async () => {
    const response = await createRouter()(diagnosisRequest(), { ENVIRONMENT: "production" });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ai_binding_unavailable" },
    });
  });

  it("requires JSON content type", async () => {
    const request = diagnosisRequest();
    const body = await request.text();
    const response = await createRouter()(new Request(request.url, { method: "POST", body }), {
      ENVIRONMENT: "test",
      AI_FIXTURE_MODE: "true",
    });
    expect(response.status).toBe(415);
  });
});
