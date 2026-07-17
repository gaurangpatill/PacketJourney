import type { EvidenceItem, ExpertiseMode, JourneyStage } from "../investigation/schema";

const beginnerTitles: Partial<Record<JourneyStage["type"], string>> = {
  input: "Your browser",
  dns: "Find website address",
  tls: "Secure connection",
  redirect: "New destination",
  edge: "Nearby edge server",
  cache: "Check saved copy",
  origin: "Website server",
  browser: "Build the page",
  resource: "Page resource",
  "third-party": "External service",
  error: "Journey stopped",
};

const beginnerDescriptions: Partial<Record<JourneyStage["type"], string>> = {
  input: "The request starts here.",
  dns: "Looks up where the site lives.",
  tls: "Checks identity and encrypts traffic.",
  redirect: "The browser is sent to another URL.",
  edge: "A nearby network location handles traffic.",
  cache: "Looks for a reusable response.",
  origin: "The application prepares a response.",
  browser: "Turns responses into visible content.",
  resource: "Loads something the page needs.",
  "third-party": "Contacts a service outside this site.",
  error: "The request cannot continue.",
};

export function nodeTitle(stage: JourneyStage, expertise: ExpertiseMode) {
  if (expertise === "beginner") return beginnerTitles[stage.type] ?? stage.shortTitle;
  if (expertise === "developer") return stage.shortTitle;
  return stage.title;
}

export function nodeDescription(stage: JourneyStage, expertise: ExpertiseMode) {
  if (expertise === "beginner") return beginnerDescriptions[stage.type] ?? stage.description;
  if (expertise === "developer") return stage.description;
  const protocol = stage.evidence.find((item) =>
    /protocol|version|status|cache-control|alpn|record/i.test(item.label),
  );
  const detail =
    protocol && (typeof protocol.value === "string" || typeof protocol.value === "number")
      ? ` · ${protocol.label}: ${String(protocol.value)}`
      : "";
  return `${stage.description}${detail}`;
}

export function accessibleNodeLabel(stage: JourneyStage, expertise: ExpertiseMode) {
  const duration =
    stage.durationMs === undefined ? "duration unavailable" : `${stage.durationMs} milliseconds`;
  const visibleTitle = nodeTitle(stage, expertise);
  const title =
    visibleTitle === stage.title ? stage.title : `${stage.title}, shown as ${visibleTitle}`;
  return `${title}. ${stage.status} stage. ${duration}. ${stage.evidence.length} evidence items.`;
}

export function visibleEvidenceItems(
  evidence: EvidenceItem[],
  expertise: ExpertiseMode,
): EvidenceItem[] {
  if (expertise === "engineer") return evidence;
  if (expertise === "developer") {
    return evidence.filter(
      (item) => !/resolver query metadata|fetch tls metadata/i.test(item.label),
    );
  }
  const summaries = evidence.filter((item) => /summary|error|status$/i.test(item.label));
  return summaries.length > 0 ? summaries.slice(0, 3) : evidence.slice(0, 2);
}
