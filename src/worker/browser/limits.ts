export const BROWSER_VIEWPORT = {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
} as const;

export const BROWSER_LIMITS = {
  navigationTimeoutMs: 20_000,
  investigationTimeoutMs: 25_000,
  maximumRedirects: 8,
  maximumObservedResources: 500,
  maximumResources: 150,
  maximumDomains: 40,
  maximumFailedRequests: 30,
  maximumConsoleEntries: 40,
  maximumUrlLength: 768,
  maximumConsoleMessageLength: 1_024,
  maximumScreenshotBytes: 1_500_000,
  screenshotRetentionSeconds: 86_400,
} as const;
