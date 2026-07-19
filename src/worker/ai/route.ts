import {
  diagnoseInvestigationRequestSchema,
  diagnoseInvestigationResponseSchema,
} from "../../features/investigation/aiSchema";
import type { Env } from "../env";
import { WorkerError } from "../errors";
import { logEvent } from "../logging";
import { AiModelError, type InvestigationAiClient, WorkersAiClient } from "./client";
import { readAiRuntimeConfig } from "./config";
import { FixtureAiClient } from "./fixture";
import { diagnoseInvestigation } from "./orchestrator";
import { AiQuestionError } from "./question";
import { AiToolError } from "./toolRegistry";
import { AiOutputError } from "./validation";
import {
  FixtureReferenceRetriever,
  UnavailableReferenceRetriever,
  VectorizeReferenceRetriever,
} from "../references/retrieval";

const MAX_AI_BODY_LENGTH = 512_000;

async function readBody(request: Request): Promise<unknown> {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new WorkerError(415, {
      code: "invalid_request",
      message: "The diagnosis endpoint accepts application/json only.",
      retryable: false,
    });
  }
  const length = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (length > MAX_AI_BODY_LENGTH) {
    throw new WorkerError(413, {
      code: "invalid_request",
      message: "The diagnosis request exceeds the allowed size.",
      retryable: false,
    });
  }
  const text = await request.text();
  if (text.length > MAX_AI_BODY_LENGTH) {
    throw new WorkerError(413, {
      code: "invalid_request",
      message: "The diagnosis request exceeds the allowed size.",
      retryable: false,
    });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new WorkerError(400, {
      code: "invalid_request",
      message: "The diagnosis request must be valid JSON.",
      retryable: false,
    });
  }
}

async function payloadHash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function enforceLimits(request: Request, env: Env, investigation: unknown) {
  const client = request.headers.get("cf-connecting-ip") ?? "unidentified-client";
  if (env.AI_INVESTIGATION_RATE_LIMITER) {
    const result = await env.AI_INVESTIGATION_RATE_LIMITER.limit({ key: `ai:${client}` });
    if (!result.success) {
      throw new WorkerError(429, {
        code: "ai_rate_limited",
        message: "Too many AI investigations were requested. Try again shortly.",
        retryable: true,
      });
    }
  }
  if (env.AI_INVESTIGATION_HASH_RATE_LIMITER) {
    const hash = await payloadHash(investigation);
    const result = await env.AI_INVESTIGATION_HASH_RATE_LIMITER.limit({
      key: `ai-payload:${hash}`,
    });
    if (!result.success) {
      throw new WorkerError(429, {
        code: "ai_rate_limited",
        message: "This investigation has reached its diagnosis limit. Try again shortly.",
        retryable: true,
      });
    }
  }
}

function publicAiError(error: unknown): WorkerError | undefined {
  if (error instanceof WorkerError) return error;
  if (error instanceof AiQuestionError) {
    return new WorkerError(400, {
      code: "ai_invalid_question",
      message: error.message,
      retryable: false,
    });
  }
  if (error instanceof AiOutputError || error instanceof AiToolError) {
    logEvent("error", "ai.output.validation_failed", {
      errorType: error.name,
      validationCode: error.code,
      validationMessage: error.message.slice(0, 400),
    });
    return new WorkerError(502, {
      code: "ai_invalid_output",
      message: "The AI response failed Packet Journey's evidence validation and was not displayed.",
      retryable: true,
    });
  }
  if (error instanceof AiModelError) {
    const code =
      error.code === "gateway_failed"
        ? "ai_gateway_failed"
        : error.code === "rate_limited"
          ? "ai_model_rate_limited"
          : "ai_inference_failed";
    return new WorkerError(
      error.code === "timeout" ? 504 : error.code === "rate_limited" ? 429 : 502,
      {
        code,
        message: error.message,
        retryable: true,
      },
    );
  }
  return undefined;
}

export async function handleAiDiagnosis(input: {
  request: Request;
  env: Env;
  investigationId: string;
  client?: InvestigationAiClient;
}): Promise<Response> {
  try {
    const config = readAiRuntimeConfig(input.env);
    if (!config.enabled) {
      throw new WorkerError(503, {
        code: "ai_disabled",
        message: "AI investigation is disabled in this environment.",
        retryable: false,
      });
    }
    const parsed = diagnoseInvestigationRequestSchema.safeParse(await readBody(input.request));
    if (!parsed.success || parsed.data.investigation.id !== input.investigationId) {
      throw new WorkerError(400, {
        code: "invalid_request",
        message: "Provide a valid investigation, matching path ID, expertise mode, and question.",
        retryable: false,
      });
    }
    await enforceLimits(input.request, input.env, parsed.data.investigation);
    const client =
      input.client ??
      (config.fixtureMode
        ? new FixtureAiClient()
        : input.env.AI
          ? new WorkersAiClient(input.env.AI)
          : undefined);
    if (!client) {
      throw new WorkerError(503, {
        code: "ai_binding_unavailable",
        message: "The Workers AI binding is unavailable in this environment.",
        retryable: false,
      });
    }
    const fixtureReferences =
      config.fixtureMode ||
      (input.env.REFERENCE_FIXTURE_MODE === "true" &&
        (input.env.ENVIRONMENT === "development" || input.env.ENVIRONMENT === "test"));
    const referenceRetriever =
      parsed.data.referenceMode === "authoritative"
        ? fixtureReferences
          ? new FixtureReferenceRetriever()
          : input.env.AI && input.env.TECHNICAL_REFERENCES && input.env.DB
            ? new VectorizeReferenceRetriever(
                input.env.AI,
                input.env.TECHNICAL_REFERENCES,
                input.env.DB,
              )
            : new UnavailableReferenceRetriever()
        : undefined;
    const result = await diagnoseInvestigation({
      ...parsed.data,
      client,
      config,
      referenceRetriever,
    });
    const response = diagnoseInvestigationResponseSchema.parse(result);
    logEvent("info", "ai.diagnosis.completed", {
      investigationId: input.investigationId,
      model: response.usage?.model,
      promptVersion: response.usage?.promptVersion,
      conclusionType: response.diagnosis.conclusionType,
      toolCallCount: response.usage?.toolCalls.length,
      inputCharacters: response.usage?.inputCharacters,
      outputCharacters: response.usage?.outputCharacters,
      fixture: response.usage?.fixture,
      referenceStatus: response.diagnosis.retrievalMetadata?.status,
      referenceCount: response.diagnosis.referenceCitations.length,
    });
    return Response.json(response);
  } catch (error) {
    const known = publicAiError(error);
    if (known) throw known;
    throw error;
  }
}
