// @vitest-environment node
import { describe, expect, it } from "vitest";
import { investigationById, investigations } from "../../data/investigations";
import { readAiRuntimeConfig } from "./config";
import { FixtureAiClient } from "./fixture";
import { diagnoseInvestigation } from "./orchestrator";

const config = readAiRuntimeConfig({ ENVIRONMENT: "test", AI_FIXTURE_MODE: "true" });

describe("evidence-grounded AI orchestrator", () => {
  it("returns schema-valid cited fixture diagnoses across seeded scenarios", async () => {
    for (const investigation of investigations) {
      const result = await diagnoseInvestigation({
        investigation,
        question: "What can the evidence support, and what remains unknown?",
        expertiseMode: "developer",
        client: new FixtureAiClient(),
        config,
      });
      const evidenceIds = new Set(
        investigation.stages.flatMap((stage) => stage.evidence.map((item) => item.id)),
      );
      expect(
        result.diagnosis.evidenceReferences.every((reference) =>
          evidenceIds.has(reference.evidenceId),
        ),
      ).toBe(true);
      expect(result.diagnosis.source).toBe("fixture");
    }
  });

  it("does not call the model when relevant evidence is absent", async () => {
    const investigation = structuredClone(investigationById.get("fast-cached")!);
    investigation.stages.find((stage) => stage.type === "dns")!.evidence = [];
    const client = {
      plan: () => Promise.reject(new Error("must not run")),
      diagnose: () => Promise.reject(new Error("must not run")),
    };
    const result = await diagnoseInvestigation({
      investigation,
      question: "Is the DNS configuration healthy?",
      expertiseMode: "developer",
      client,
      config,
    });
    expect(result.diagnosis.conclusionType).toBe("inconclusive");
    expect(result.diagnosis.source).toBe("evidence-guard");
  });

  it("answers deterministic status questions without model inference", async () => {
    const client = {
      plan: () => Promise.reject(new Error("must not plan")),
      diagnose: () => Promise.reject(new Error("must not diagnose")),
    };
    const result = await diagnoseInvestigation({
      investigation: investigationById.get("fast-cached")!,
      question: "Is the certificate evidence healthy?",
      expertiseMode: "developer",
      selectedStageId: "tls",
      client,
      config,
    });

    expect(result.usage.toolCalls).toEqual([]);
    expect(result.diagnosis.source).toBe("evidence-guard");
    expect(result.diagnosis.evidenceReferences.length).toBeGreaterThan(0);
    expect(result.diagnosis.answer).toMatch(/does not prove/i);
  });

  it("surfaces an evidence-linked deterministic certificate failure", async () => {
    const result = await diagnoseInvestigation({
      investigation: investigationById.get("tls-warning")!,
      question: "Is the certificate valid?",
      expertiseMode: "developer",
      selectedStageId: "tls",
      client: {
        plan: () => Promise.reject(new Error("must not plan")),
        diagnose: () => Promise.reject(new Error("must not diagnose")),
      },
      config,
    });

    expect(result.diagnosis.source).toBe("evidence-guard");
    expect(result.diagnosis.conclusionType).toBe("supported");
    expect(result.diagnosis.primaryFinding?.severity).toBe("high");
    expect(result.diagnosis.evidenceReferences).toHaveLength(2);
  });

  it("explains certificate-transparency fallback without discarding validity and coverage", async () => {
    const investigation = structuredClone(investigationById.get("fast-cached")!);
    const tls = investigation.stages.find((stage) => stage.type === "tls")!;
    tls.title = "Certificate for example.com";
    tls.evidence = [
      {
        id: "tls-certificate",
        label: "Normalized certificate",
        value: {
          requestedHostname: "example.com",
          observationKind: "certificate-transparency",
        },
        source: "SSLMate Cert Spotter Certificate Transparency API",
        collectedAt: investigation.createdAt,
        confidence: "verified",
      },
      {
        id: "tls-validity",
        label: "Certificate validity",
        value: {
          status: "valid",
          validUntil: "2026-09-01T00:00:00.000Z",
          daysUntilExpiration: 44,
        },
        source: "SSLMate Cert Spotter Certificate Transparency API",
        collectedAt: investigation.createdAt,
        confidence: "verified",
      },
      {
        id: "tls-coverage",
        label: "Hostname coverage",
        value: { covered: true, matchedName: "example.com" },
        source: "Deterministic DNS SAN and common-name matcher",
        collectedAt: investigation.createdAt,
        confidence: "inferred",
      },
      {
        id: "tls-error",
        label: "Certificate inspection error",
        value: { code: "probe_connection_failed", message: "Peer probe failed." },
        source: "Independent certificate probe state machine",
        collectedAt: investigation.createdAt,
        confidence: "verified",
      },
    ];

    const result = await diagnoseInvestigation({
      investigation,
      question: "Is the certificate evidence healthy?",
      expertiseMode: "developer",
      client: {
        plan: () => Promise.reject(new Error("must not plan")),
        diagnose: () => Promise.reject(new Error("must not diagnose")),
      },
      config,
    });

    expect(result.diagnosis.conclusionType).toBe("inconclusive");
    expect(result.diagnosis.summary).toMatch(/issuance evidence was collected/i);
    expect(result.diagnosis.answer).toMatch(/peer-certificate probe failed/i);
    expect(result.diagnosis.answer).toMatch(/cannot confirm the certificate currently served/i);
    expect(result.diagnosis.evidenceReferences.map((item) => item.evidenceId)).toEqual([
      "tls-validity",
      "tls-coverage",
      "tls-certificate",
      "tls-error",
    ]);
  });

  it("reports a healthy independent served-peer certificate with a fetch-session limitation", async () => {
    const investigation = structuredClone(investigationById.get("fast-cached")!);
    const tls = investigation.stages.find((stage) => stage.type === "tls")!;
    tls.title = "Certificate for example.com";
    tls.evidence = [
      {
        id: "tls-certificate",
        label: "Normalized certificate",
        value: { requestedHostname: "example.com", observationKind: "served-peer" },
        source: "Independent Cloudflare Worker node:tls certificate probe",
        collectedAt: investigation.createdAt,
        confidence: "verified",
      },
      {
        id: "tls-validity",
        label: "Certificate validity",
        value: { status: "valid", validUntil: "2026-09-01T00:00:00.000Z" },
        source: "Independent Cloudflare Worker node:tls certificate probe",
        collectedAt: investigation.createdAt,
        confidence: "verified",
      },
      {
        id: "tls-coverage",
        label: "Hostname coverage",
        value: { covered: true, matchedName: "example.com" },
        source: "Deterministic DNS SAN and common-name matcher",
        collectedAt: investigation.createdAt,
        confidence: "inferred",
      },
    ];

    const result = await diagnoseInvestigation({
      investigation,
      question: "Is the certificate evidence healthy?",
      expertiseMode: "network-engineer",
      client: {
        plan: () => Promise.reject(new Error("must not plan")),
        diagnose: () => Promise.reject(new Error("must not diagnose")),
      },
      config,
    });

    expect(result.diagnosis.conclusionType).toBe("supported");
    expect(result.diagnosis.summary).toMatch(/currently valid and covers/i);
    expect(result.diagnosis.answer).toMatch(/does not expose the certificate selected/i);
  });

  it("skips planning for a narrow explanation while retaining model synthesis", async () => {
    const fixture = new FixtureAiClient();
    let planningCalls = 0;
    const result = await diagnoseInvestigation({
      investigation: investigationById.get("fast-cached")!,
      question: "Explain the certificate evidence.",
      expertiseMode: "developer",
      selectedStageId: "tls",
      client: {
        plan: () => {
          planningCalls += 1;
          return Promise.resolve({ toolCalls: [] });
        },
        diagnose: (input) => fixture.diagnose(input),
      },
      config,
    });

    expect(planningCalls).toBe(0);
    expect(result.diagnosis.source).toBe("fixture");
  });

  it("returns a deterministic evidence guard when model output is unsafe", async () => {
    const result = await diagnoseInvestigation({
      investigation: investigationById.get("fast-cached")!,
      question: "Explain the certificate evidence.",
      expertiseMode: "developer",
      client: {
        plan: () => Promise.resolve({ toolCalls: [] }),
        diagnose: () => Promise.resolve({ output: { invented: true }, rawCharacters: 17 }),
      },
      config,
    });

    expect(result.diagnosis.source).toBe("evidence-guard");
    expect(result.diagnosis.conclusionType).toBe("inconclusive");
    expect(result.diagnosis.answer).toMatch(/could not safely validate/i);
  });
});
