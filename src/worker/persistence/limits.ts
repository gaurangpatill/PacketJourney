export const PERSISTENCE_LIMITS = {
  maximumSnapshotBytes: 900_000,
  maximumReportBytes: 1_000_000,
  maximumSavedInvestigations: 100,
  maximumSharesPerInvestigation: 10,
  defaultPageSize: 20,
  maximumPageSize: 50,
  maximumShareLifetimeMs: 30 * 24 * 60 * 60 * 1_000,
  savedArtifactRetentionMs: 30 * 24 * 60 * 60 * 1_000,
  maximumRequestBytes: 1_500_000,
} as const;
