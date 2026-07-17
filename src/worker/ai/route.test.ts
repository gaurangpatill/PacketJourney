// @vitest-environment node
import { describe, expect, it } from "vitest";
import { investigationById } from "../../data/investigations";
import { createRouter } from "../router";
import { diagnoseInvestigationResponseSchema } from "../../features/investigation/aiSchema";

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
