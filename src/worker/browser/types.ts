import type { ArtifactReference } from "../../features/investigation/schema";

export type BrowserResourceType =
  | "document"
  | "script"
  | "stylesheet"
  | "image"
  | "font"
  | "fetch"
  | "xhr"
  | "media"
  | "iframe"
  | "websocket"
  | "preflight"
  | "other";

export type ThirdPartyCategory =
  | "analytics"
  | "advertising"
  | "authentication"
  | "payments"
  | "error-monitoring"
  | "customer-support"
  | "tag-management"
  | "fonts"
  | "media"
  | "cdn"
  | "unknown";

export interface BrowserResource {
  id: string;
  url: string;
  origin: string;
  hostname: string;
  type: BrowserResourceType;
  method: string;
  status?: number;
  contentType?: string;
  transferSize?: number;
  encodedBodySize?: number;
  decodedBodySize?: number;
  startTimeMs?: number;
  durationMs?: number;
  protocol?: string;
  firstParty: boolean;
  classificationBasis: string;
  thirdPartyCategory?: ThirdPartyCategory;
  failed: boolean;
  failureReason?: string;
  beforeDomContentLoaded?: boolean;
  beforeLoad?: boolean;
  renderBlockingCandidate: boolean;
  initiator?: string;
}

export interface BrowserConsoleEntry {
  level: "error" | "warning";
  message: string;
  sourceUrl?: string;
  line?: number;
  column?: number;
  timestamp: string;
  origin: "page-console" | "page-error";
  truncated: boolean;
}

export interface BrowserNavigationMetrics {
  timeToFirstByteMs?: number;
  domContentLoadedMs?: number;
  loadEventMs?: number;
  firstPaintMs?: number;
  firstContentfulPaintMs?: number;
  largestContentfulPaintMs?: number;
}

export interface BrowserResourceSummary {
  totalObserved: number;
  retained: number;
  truncated: boolean;
  firstPartyCount: number;
  thirdPartyCount: number;
  failedCount: number;
  totalTransferBytes?: number;
  javascriptTransferBytes?: number;
  stylesheetTransferBytes?: number;
  imageTransferBytes?: number;
  thirdPartyTransferBytes?: number;
  domains: number;
}

export type BrowserDiagnosticErrorCode =
  | "browser_binding_unavailable"
  | "browser_launch_failed"
  | "browser_page_failed"
  | "browser_navigation_timeout"
  | "browser_navigation_blocked"
  | "browser_navigation_failed"
  | "browser_collection_failed"
  | "browser_screenshot_failed"
  | "browser_artifact_unavailable"
  | "browser_artifact_failed";

export interface BrowserDiagnosticError {
  code: BrowserDiagnosticErrorCode;
  message: string;
  retryable: boolean;
  phase: "binding" | "launch" | "navigation" | "collection" | "screenshot" | "artifact";
}

export interface BrowserDiagnosticResult {
  status: "success" | "partial" | "unavailable" | "error";
  requestedUrl: string;
  finalUrl?: string;
  title?: string;
  mainDocumentStatus?: number;
  mainDocumentContentType?: string;
  redirectCount: number;
  readiness: "loaded" | "dom-content-loaded" | "partial" | "unavailable";
  viewport: { width: number; height: number; deviceScaleFactor: number };
  navigation: BrowserNavigationMetrics;
  resources: BrowserResource[];
  resourceSummary: BrowserResourceSummary;
  console: BrowserConsoleEntry[];
  consoleTruncated: boolean;
  blockedRequests: BrowserResource[];
  artifact?: ArtifactReference;
  errors: BrowserDiagnosticError[];
  limitations: string[];
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export interface BrowserInvestigator {
  investigate(url: string): Promise<BrowserDiagnosticResult>;
}
