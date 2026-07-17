import { z } from "zod";

export const stageTypeSchema = z.enum([
  "input",
  "dns",
  "tls",
  "redirect",
  "edge",
  "cache",
  "origin",
  "browser",
  "resource",
  "third-party",
  "error",
]);

export const stageStatusSchema = z.enum(["pending", "active", "success", "warning", "error"]);
export const evidenceConfidenceSchema = z.enum(["verified", "inferred"]);

export const evidenceItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  value: z.unknown(),
  source: z.string().min(1),
  collectedAt: z.string().datetime(),
  confidence: evidenceConfidenceSchema,
});

export const journeyStageSchema = z.object({
  id: z.string().min(1),
  type: stageTypeSchema,
  title: z.string().min(1),
  shortTitle: z.string().min(1),
  description: z.string().min(1),
  status: stageStatusSchema,
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  durationMs: z.number().nonnegative().optional(),
  evidence: z.array(evidenceItemSchema),
  connections: z.array(z.string()),
  branch: z.number().int().min(0).default(0),
});

export const findingSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["info", "low", "medium", "high"]),
  category: z.enum([
    "dns",
    "tls",
    "redirect",
    "cache",
    "origin",
    "frontend",
    "security",
    "third-party",
  ]),
  title: z.string().min(1),
  explanation: z.string().min(1),
  evidenceIds: z.array(z.string()),
  recommendation: z.string().optional(),
  confidence: z.number().min(0).max(1),
});

export const artifactReferenceSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "screenshot",
    "resource-manifest",
    "console-log",
    "browser-report",
    "report",
    "trace",
  ]),
  label: z.string().min(1),
  storage: z.enum(["r2"]).optional(),
  contentType: z.string().min(1).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  createdAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  access: z.enum(["worker-mediated", "private", "public-demo"]).optional(),
  description: z.string().min(1).optional(),
  url: z.string().optional(),
});

export const investigationMetricsSchema = z.object({
  totalDurationMs: z.number().nonnegative(),
  dnsMs: z.number().nonnegative().optional(),
  tlsMs: z.number().nonnegative().optional(),
  timeToFirstByteMs: z.number().nonnegative().optional(),
  firstContentfulPaintMs: z.number().nonnegative().optional(),
  domContentLoadedMs: z.number().nonnegative().optional(),
  loadEventMs: z.number().nonnegative().optional(),
  largestContentfulPaintMs: z.number().nonnegative().optional(),
  browserDurationMs: z.number().nonnegative().optional(),
  transferredBytes: z.number().int().nonnegative().optional(),
  requestCount: z.number().int().nonnegative().optional(),
  thirdPartyCount: z.number().int().nonnegative().optional(),
});

export const investigationSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().min(1),
    scenario: z.enum([
      "fast-cached",
      "redirect-chain",
      "slow-origin",
      "third-party-heavy",
      "tls-warning",
      "missing-cache",
      "edge-cache-simulation",
      "live-http",
    ]),
    url: z.string().url(),
    normalizedUrl: z.string().url(),
    status: z.enum(["queued", "running", "completed", "failed"]),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
    stages: z.array(journeyStageSchema).min(1),
    findings: z.array(findingSchema),
    metrics: investigationMetricsSchema,
    artifacts: z.array(artifactReferenceSchema),
    mock: z.boolean(),
  })
  .superRefine((investigation, context) => {
    const allStageIds = investigation.stages.map((stage) => stage.id);
    const allEvidenceIds = investigation.stages.flatMap((stage) =>
      stage.evidence.map((item) => item.id),
    );
    const stageIds = new Set(allStageIds);
    const evidenceIds = new Set(allEvidenceIds);

    if (stageIds.size !== allStageIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Stage IDs must be unique within an investigation",
        path: ["stages"],
      });
    }

    if (evidenceIds.size !== allEvidenceIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Evidence IDs must be unique within an investigation",
        path: ["stages"],
      });
    }

    for (const stage of investigation.stages) {
      for (const connection of stage.connections) {
        if (connection === stage.id) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Stage ${stage.id} cannot connect to itself`,
            path: ["stages"],
          });
        }
        if (!stageIds.has(connection)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Stage ${stage.id} connects to missing stage ${connection}`,
            path: ["stages"],
          });
        }
      }
    }

    for (const finding of investigation.findings) {
      for (const evidenceId of finding.evidenceIds) {
        if (!evidenceIds.has(evidenceId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Finding ${finding.id} references missing evidence ${evidenceId}`,
            path: ["findings"],
          });
        }
      }
    }
  });

export type Investigation = z.infer<typeof investigationSchema>;
export type JourneyStage = z.infer<typeof journeyStageSchema>;
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type ArtifactReference = z.infer<typeof artifactReferenceSchema>;
export type ExpertiseMode = "beginner" | "developer" | "engineer";
