import { z } from "zod";
import type { Investigation, JourneyStage } from "../../features/investigation/schema";
import { categoryForStage } from "./evidenceSelection";
import type { AiToolCall, AiToolResult } from "./types";

const toolResultSchema = z
  .object({
    kind: z.string().min(1).max(80),
    data: z.unknown(),
    truncated: z.boolean(),
  })
  .strict();

type ToolResult = z.infer<typeof toolResultSchema>;
type JsonSchema = {
  type: "object";
  properties: Record<string, { type: string; description: string }>;
  required: string[];
};

interface AiToolDefinition<T extends z.ZodTypeAny = z.ZodType<unknown>> {
  name: string;
  description: string;
  inputSchema: T;
  parameters: JsonSchema;
  execute: (investigation: Investigation, input: z.infer<T>) => ToolResult;
}

function stageOrThrow(investigation: Investigation, stageId: string): JourneyStage {
  const stage = investigation.stages.find((candidate) => candidate.id === stageId);
  if (!stage)
    throw new AiToolError("out_of_scope", `Stage ${stageId} is not in this investigation.`);
  return stage;
}

function evidenceView(stage: JourneyStage, limit: number) {
  return stage.evidence.slice(0, limit).map((item) => ({
    id: item.id,
    label: item.label.slice(0, 180),
    value: item.value,
    confidence: item.confidence,
    source: item.source.slice(0, 240),
  }));
}

function collectObjects(value: unknown, predicate: (value: Record<string, unknown>) => boolean) {
  const output: Record<string, unknown>[] = [];
  const visit = (candidate: unknown, depth: number) => {
    if (depth > 4 || output.length >= 30) return;
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, depth + 1);
      return;
    }
    if (candidate && typeof candidate === "object") {
      const record = candidate as Record<string, unknown>;
      if (predicate(record)) output.push(record);
      for (const item of Object.values(record)) visit(item, depth + 1);
    }
  };
  visit(value, 0);
  return output;
}

function unknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

const optionalLimit = (maximum: number) =>
  z.preprocess(
    (value) => (value === null ? undefined : value),
    z.number().int().min(1).max(maximum).optional(),
  );

const stageInput = z.object({ stageId: z.string().min(1).max(160) }).strict();
const stageLimitInput = z
  .object({
    stageId: z.string().min(1).max(160),
    limit: optionalLimit(12),
  })
  .strict();
const categoryInput = z.object({ limit: optionalLimit(15) }).strict();

const definitions: AiToolDefinition[] = [
  {
    name: "get_investigation_summary",
    description: "Returns bounded stages, metrics, and deterministic finding summaries.",
    inputSchema: z.object({}).strict(),
    parameters: { type: "object", properties: {}, required: [] },
    execute: (investigation) => ({
      kind: "investigation-summary",
      data: {
        status: investigation.status,
        normalizedUrl: investigation.normalizedUrl,
        metrics: investigation.metrics,
        stages: investigation.stages.slice(0, 50).map((stage) => ({
          id: stage.id,
          type: stage.type,
          status: stage.status,
          durationMs: stage.durationMs,
          title: stage.title,
        })),
        findings: investigation.findings.slice(0, 12).map((finding) => ({
          id: finding.id,
          category: finding.category,
          severity: finding.severity,
          title: finding.title,
          evidenceIds: finding.evidenceIds,
        })),
      },
      truncated: investigation.stages.length > 50 || investigation.findings.length > 12,
    }),
  },
  {
    name: "get_stage_evidence",
    description: "Returns bounded evidence for one existing journey stage.",
    inputSchema: stageLimitInput,
    parameters: {
      type: "object",
      properties: {
        stageId: { type: "string", description: "Existing stage ID from this investigation." },
        limit: { type: "number", description: "Maximum evidence items from 1 to 12." },
      },
      required: ["stageId"],
    },
    execute: (investigation, input) => {
      const parsedInput = stageLimitInput.parse(input);
      const stage = stageOrThrow(investigation, parsedInput.stageId);
      const limit = parsedInput.limit ?? 8;
      return {
        kind: "stage-evidence",
        data: {
          stageId: stage.id,
          category: categoryForStage(stage),
          evidence: evidenceView(stage, limit),
        },
        truncated: stage.evidence.length > limit,
      };
    },
  },
  {
    name: "get_related_findings",
    description: "Returns deterministic findings linked to one existing stage's evidence.",
    inputSchema: stageInput,
    parameters: {
      type: "object",
      properties: {
        stageId: { type: "string", description: "Existing stage ID from this investigation." },
      },
      required: ["stageId"],
    },
    execute: (investigation, input) => {
      const parsedInput = stageInput.parse(input);
      const stage = stageOrThrow(investigation, parsedInput.stageId);
      const evidenceIds = new Set(stage.evidence.map((item) => item.id));
      const findings = investigation.findings
        .filter((finding) => finding.evidenceIds.some((id) => evidenceIds.has(id)))
        .slice(0, 12);
      return { kind: "related-findings", data: findings, truncated: findings.length === 12 };
    },
  },
  {
    name: "get_resource_group",
    description: "Returns bounded browser resource records already present in the investigation.",
    inputSchema: categoryInput,
    parameters: {
      type: "object",
      properties: { limit: { type: "number", description: "Maximum resource records 1 to 15." } },
      required: [],
    },
    execute: (investigation, input) => {
      const parsedInput = categoryInput.parse(input);
      const limit = parsedInput.limit ?? 12;
      const resources = investigation.stages
        .flatMap((stage) => stage.evidence)
        .filter((item) => /browser resources/i.test(item.label))
        .flatMap((item) => unknownArray(item.value));
      return {
        kind: "resource-group",
        data: resources.slice(0, limit),
        truncated: resources.length > limit,
      };
    },
  },
  {
    name: "get_failed_requests",
    description: "Returns bounded failed or blocked resource records already collected.",
    inputSchema: categoryInput,
    parameters: {
      type: "object",
      properties: { limit: { type: "number", description: "Maximum failed records 1 to 15." } },
      required: [],
    },
    execute: (investigation, input) => {
      const parsedInput = categoryInput.parse(input);
      const limit = parsedInput.limit ?? 10;
      const failures = investigation.stages
        .flatMap((stage) => stage.evidence)
        .flatMap((item) =>
          collectObjects(
            item.value,
            (record) => record.failed === true || "failureReason" in record,
          ),
        );
      return {
        kind: "failed-requests",
        data: failures.slice(0, limit),
        truncated: failures.length > limit,
      };
    },
  },
  {
    name: "get_console_errors",
    description: "Returns bounded browser console errors and warnings already collected.",
    inputSchema: categoryInput,
    parameters: {
      type: "object",
      properties: { limit: { type: "number", description: "Maximum console entries 1 to 15." } },
      required: [],
    },
    execute: (investigation, input) => {
      const parsedInput = categoryInput.parse(input);
      const limit = parsedInput.limit ?? 8;
      const entries = investigation.stages
        .flatMap((stage) => stage.evidence)
        .filter((item) => /console/i.test(item.label))
        .flatMap((item) => {
          if (!item.value || typeof item.value !== "object") return [];
          const value = item.value as Record<string, unknown>;
          return unknownArray(value.entries);
        });
      return {
        kind: "console-errors",
        data: entries.slice(0, limit),
        truncated: entries.length > limit,
      };
    },
  },
  ...(["cache", "dns", "tls"] as const).map(
    (category) =>
      ({
        name: `get_${category}_evidence`,
        description: `Returns bounded ${category.toUpperCase()} evidence already present.`,
        inputSchema: categoryInput,
        parameters: {
          type: "object",
          properties: { limit: { type: "number", description: "Maximum evidence items 1 to 15." } },
          required: [],
        },
        execute: (investigation: Investigation, input: unknown) => {
          const parsedInput = categoryInput.parse(input);
          const limit = parsedInput.limit ?? 12;
          const stages = investigation.stages.filter((stage) => stage.type === category);
          const evidence = stages.flatMap((stage) =>
            evidenceView(stage, limit).map((item) => ({ stageId: stage.id, ...item })),
          );
          return {
            kind: `${category}-evidence`,
            data: evidence.slice(0, limit),
            truncated: evidence.length > limit,
          };
        },
      }) satisfies AiToolDefinition,
  ),
  {
    name: "get_browser_metrics",
    description:
      "Returns browser-relative metrics and their evidence, without inventing missing values.",
    inputSchema: z.object({}).strict(),
    parameters: { type: "object", properties: {}, required: [] },
    execute: (investigation) => ({
      kind: "browser-metrics",
      data: {
        metrics: {
          firstContentfulPaintMs: investigation.metrics.firstContentfulPaintMs,
          largestContentfulPaintMs: investigation.metrics.largestContentfulPaintMs,
          domContentLoadedMs: investigation.metrics.domContentLoadedMs,
          loadEventMs: investigation.metrics.loadEventMs,
          browserDurationMs: investigation.metrics.browserDurationMs,
          requestCount: investigation.metrics.requestCount,
          thirdPartyCount: investigation.metrics.thirdPartyCount,
          transferredBytes: investigation.metrics.transferredBytes,
        },
        evidence: investigation.stages
          .filter((stage) => stage.type === "browser")
          .flatMap((stage) =>
            evidenceView(stage, 8).map((item) => ({ stageId: stage.id, ...item })),
          )
          .slice(0, 12),
      },
      truncated: false,
    }),
  },
  {
    name: "compare_stage_durations",
    description: "Ranks measured stage durations; unavailable durations remain absent.",
    inputSchema: z.object({}).strict(),
    parameters: { type: "object", properties: {}, required: [] },
    execute: (investigation) => ({
      kind: "stage-duration-comparison",
      data: investigation.stages
        .filter((stage) => stage.durationMs !== undefined)
        .map((stage) => ({ stageId: stage.id, type: stage.type, durationMs: stage.durationMs }))
        .sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0))
        .slice(0, 20),
      truncated: investigation.stages.filter((stage) => stage.durationMs !== undefined).length > 20,
    }),
  },
];

const registry = new Map(definitions.map((definition) => [definition.name, definition]));

export class AiToolError extends Error {
  constructor(
    readonly code:
      | "unknown_tool"
      | "invalid_arguments"
      | "out_of_scope"
      | "duplicate_call"
      | "tool_limit"
      | "output_limit",
    message: string,
  ) {
    super(message);
    this.name = "AiToolError";
  }
}

export function modelToolDefinitions() {
  return definitions.map((definition) => ({
    type: "function" as const,
    function: {
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
    },
  }));
}

export function executeAiToolCalls(input: {
  investigation: Investigation;
  calls: AiToolCall[];
  maximumCalls: number;
  maximumOutputCharacters?: number;
}): AiToolResult[] {
  if (input.calls.length > input.maximumCalls) {
    throw new AiToolError("tool_limit", "The model requested too many tools.");
  }
  const seen = new Set<string>();
  const results: AiToolResult[] = [];
  let totalCharacters = 0;
  const maximumOutput = input.maximumOutputCharacters ?? 12_000;

  for (const call of input.calls) {
    const definition = registry.get(call.name);
    if (!definition) throw new AiToolError("unknown_tool", `Tool ${call.name} is not approved.`);
    const parsed = definition.inputSchema.safeParse(call.arguments ?? {});
    if (!parsed.success) {
      throw new AiToolError("invalid_arguments", `Tool ${call.name} received invalid arguments.`);
    }
    const signature = `${call.name}:${JSON.stringify(parsed.data)}`;
    if (seen.has(signature)) {
      throw new AiToolError("duplicate_call", `Duplicate tool call ${call.name} was rejected.`);
    }
    seen.add(signature);
    const output = toolResultSchema.parse(definition.execute(input.investigation, parsed.data));
    const serialized = JSON.stringify(output);
    if (serialized.length > 6_000 || totalCharacters + serialized.length > maximumOutput) {
      throw new AiToolError("output_limit", `Tool ${call.name} exceeded its output budget.`);
    }
    totalCharacters += serialized.length;
    results.push({
      callId: call.id.slice(0, 120),
      name: call.name,
      output,
      serializedCharacters: serialized.length,
    });
  }
  return results;
}
