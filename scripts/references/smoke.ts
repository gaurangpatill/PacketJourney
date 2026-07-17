import { investigationById } from "../../src/data/investigations";
import { diagnoseInvestigationResponseSchema } from "../../src/features/investigation/aiSchema";
import {
  createShareResponseSchema,
  saveInvestigationResponseSchema,
  sharedReportSchema,
} from "../../src/features/persistence/schema";

const base = process.env.PACKET_JOURNEY_API ?? "http://127.0.0.1:8787";
const investigation = investigationById.get("fast-cached");
if (!investigation) throw new Error("Missing smoke investigation fixture.");

async function json(response: Response): Promise<unknown> {
  const value = (await response.json()) as unknown;
  if (!response.ok)
    throw new Error(`Smoke request failed (${response.status}): ${JSON.stringify(value)}`);
  return value;
}

const diagnosis = diagnoseInvestigationResponseSchema.parse(
  await json(
    await fetch(`${base}/api/v1/investigations/${investigation.id}/diagnose`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        investigation,
        question: "Why was this document served from cache?",
        expertiseMode: "developer",
        referenceMode: "authoritative",
      }),
    }),
  ),
);
if (diagnosis.diagnosis.retrievalMetadata?.status !== "fixture") {
  throw new Error("Local diagnosis did not use the explicit reference fixture.");
}
if (!diagnosis.diagnosis.referenceCitations.length)
  throw new Error("No fixture citation returned.");

const saveResponse = await fetch(`${base}/api/v1/saved-investigations`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    title: "Layer 9 citation smoke",
    investigation,
    selectedDiagnosis: { diagnosis: diagnosis.diagnosis, expertiseMode: "developer" },
    preserveScreenshot: false,
  }),
});
const saved = saveInvestigationResponseSchema.parse(await json(saveResponse));
const cookie = saveResponse.headers.get("set-cookie")?.split(";", 1)[0];
if (!cookie) throw new Error("Owner cookie was not returned.");

const share = createShareResponseSchema.parse(
  await json(
    await fetch(`${base}/api/v1/saved-investigations/${saved.saved.summary.id}/shares`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        includeAiDiagnosis: true,
        includeCounterfactual: false,
        includeScreenshot: false,
      }),
    }),
  ),
);
const report = sharedReportSchema.parse(
  await json(await fetch(`${base}/api/v1/shared-reports/${share.token}`)),
);
if (!report.selectedDiagnosis?.diagnosis.referenceCitations.length) {
  throw new Error("Shared report did not preserve the frozen citation snapshot.");
}
if (
  report.selectedDiagnosis.diagnosis.retrievalMetadata?.controlledQuery ||
  report.selectedDiagnosis.diagnosis.retrievalMetadata?.questionHash
) {
  throw new Error("Shared report exposed private retrieval query provenance.");
}
await json(
  await fetch(`${base}/api/v1/saved-investigations/${saved.saved.summary.id}`, {
    method: "DELETE",
    headers: { cookie },
  }),
);
process.stdout.write(
  `Fixture diagnosis, D1 frozen citation, and shared snapshot verified (${diagnosis.diagnosis.referenceCitations.length} citations).\n`,
);
