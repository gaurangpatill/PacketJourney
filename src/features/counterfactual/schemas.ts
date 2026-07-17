import { z } from "zod";
import { findingSchema, investigationSchema } from "../investigation/schema";

export const COUNTERFACTUAL_ENGINE_VERSION = "1.0.0";
export const SIMULATION_LABEL = "SIMULATED · NOT MEASURED" as const;

const metadata = {
  id: z.string().min(1).max(160),
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().min(1).max(600),
  createdAt: z.string().datetime(),
  source: z.enum(["user", "suggested", "ai-suggested"]),
};

export const removeRedirectsScenarioSchema = z
  .object({
    ...metadata,
    type: z.literal("remove-redirects"),
    targetStageIds: z.array(z.string().min(1).max(160)).min(1).max(8),
  })
  .strict();

export const enableEdgeCacheScenarioSchema = z
  .object({
    ...metadata,
    type: z.literal("enable-edge-cache"),
    targetCacheStageId: z.string().min(1).max(160),
    targetOriginStageId: z.string().min(1).max(160),
  })
  .strict();

export const reduceOriginLatencyScenarioSchema = z
  .object({
    ...metadata,
    type: z.literal("reduce-origin-latency"),
    targetStageId: z.string().min(1).max(160),
    targetDurationMs: z.number().finite().nonnegative(),
  })
  .strict();

export const reduceJavascriptScenarioSchema = z
  .object({
    ...metadata,
    type: z.literal("reduce-javascript"),
    targetStageId: z.string().min(1).max(160).optional(),
    reductionPercent: z.number().finite().gt(0).lte(95).optional(),
    targetBytes: z.number().int().nonnegative().optional(),
  })
  .strict();

export const removeThirdPartyScenarioSchema = z
  .object({
    ...metadata,
    type: z.literal("remove-third-party"),
    targetStageId: z.string().min(1).max(160),
  })
  .strict();

export const resolveCriticalResourceScenarioSchema = z
  .object({
    ...metadata,
    type: z.literal("resolve-critical-resource"),
    targetResourceId: z.string().min(1).max(240),
  })
  .strict();

export const expireCertificateScenarioSchema = z
  .object({
    ...metadata,
    type: z.literal("expire-certificate"),
    targetStageId: z.string().min(1).max(160),
  })
  .strict();

export const removeDnsAddressScenarioSchema = z
  .object({
    ...metadata,
    type: z.literal("remove-dns-address"),
    targetStageId: z.string().min(1).max(160),
  })
  .strict();

export const counterfactualScenarioSchema = z
  .discriminatedUnion("type", [
    removeRedirectsScenarioSchema,
    enableEdgeCacheScenarioSchema,
    reduceOriginLatencyScenarioSchema,
    reduceJavascriptScenarioSchema,
    removeThirdPartyScenarioSchema,
    resolveCriticalResourceScenarioSchema,
    expireCertificateScenarioSchema,
    removeDnsAddressScenarioSchema,
  ])
  .superRefine((scenario, context) => {
    if (
      scenario.type === "reduce-javascript" &&
      (scenario.reductionPercent === undefined) === (scenario.targetBytes === undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide exactly one JavaScript reduction percentage or target byte count.",
      });
    }
  });

export const counterfactualChangeSchema = z
  .object({
    id: z.string().min(1).max(200),
    targetType: z.enum(["stage", "edge", "evidence", "metric", "finding", "resource", "artifact"]),
    targetId: z.string().min(1).max(240),
    operation: z.enum(["added", "removed", "modified", "unchanged", "unavailable"]),
    field: z.string().min(1).max(160).optional(),
    observedValue: z.unknown().optional(),
    simulatedValue: z.unknown().optional(),
    reason: z.string().trim().min(1).max(800),
    ruleId: z.string().min(1).max(160),
    sourceEvidenceIds: z.array(z.string().min(1).max(160)).max(32),
  })
  .strict();

export const counterfactualAssumptionSchema = z
  .object({
    id: z.string().min(1).max(200),
    statement: z.string().trim().min(1).max(800),
    category: z.enum([
      "network",
      "cache",
      "origin",
      "browser",
      "resource",
      "security",
      "availability",
    ]),
    importance: z.enum(["low", "medium", "high"]),
  })
  .strict();

export const simulatedMetricNameSchema = z.enum([
  "totalDurationMs",
  "dnsMs",
  "tlsMs",
  "timeToFirstByteMs",
  "firstContentfulPaintMs",
  "domContentLoadedMs",
  "loadEventMs",
  "largestContentfulPaintMs",
  "browserDurationMs",
  "transferredBytes",
  "requestCount",
  "thirdPartyCount",
]);

export const simulatedMetricDecisionSchema = z
  .object({
    metric: simulatedMetricNameSchema,
    policy: z.enum(["recalculated", "unchanged", "unavailable"]),
    observedValue: z.number().nonnegative().optional(),
    simulatedValue: z.number().nonnegative().optional(),
    delta: z.number().finite().optional(),
    reason: z.string().trim().min(1).max(800),
    ruleId: z.string().min(1).max(160),
  })
  .strict();

export const simulatedFindingSchema = findingSchema.extend({
  simulation: z.object({
    isSimulated: z.literal(true),
    scenarioId: z.string().min(1).max(160),
    ruleId: z.string().min(1).max(160),
    label: z.literal(SIMULATION_LABEL),
    state: z.enum(["added", "modified", "unchanged", "unreachable"]).optional(),
  }),
});

export const counterfactualResultSchema = z
  .object({
    id: z.string().min(1).max(240),
    scenario: counterfactualScenarioSchema,
    sourceInvestigationId: z.string().min(1).max(160),
    observed: investigationSchema,
    simulated: investigationSchema,
    changes: z.array(counterfactualChangeSchema).max(300),
    assumptions: z.array(counterfactualAssumptionSchema).max(24),
    metricDecisions: z.array(simulatedMetricDecisionSchema).min(1).max(20),
    unavailableMetrics: z.array(simulatedMetricNameSchema).max(20),
    resolvedFindingIds: z.array(z.string().min(1).max(160)).max(40),
    simulatedFindings: z.array(simulatedFindingSchema).max(40),
    summary: z
      .object({
        title: z.string().trim().min(1).max(240),
        description: z.string().trim().min(1).max(1_200),
        reliability: z.enum(["high", "bounded", "low"]),
        changedStageCount: z.number().int().nonnegative(),
        durationDeltaMs: z.number().finite().optional(),
      })
      .strict(),
    generatedAt: z.string().datetime(),
    engineVersion: z.literal(COUNTERFACTUAL_ENGINE_VERSION),
    label: z.literal(SIMULATION_LABEL),
  })
  .strict();

export type CounterfactualScenario = z.infer<typeof counterfactualScenarioSchema>;
export type CounterfactualScenarioType = CounterfactualScenario["type"];
export type CounterfactualChange = z.infer<typeof counterfactualChangeSchema>;
export type CounterfactualAssumption = z.infer<typeof counterfactualAssumptionSchema>;
export type SimulatedMetricName = z.infer<typeof simulatedMetricNameSchema>;
export type SimulatedMetricDecision = z.infer<typeof simulatedMetricDecisionSchema>;
export type SimulatedFinding = z.infer<typeof simulatedFindingSchema>;
export type CounterfactualResult = z.infer<typeof counterfactualResultSchema>;
