import { readFile } from "node:fs/promises";
import { REFERENCE_CONFIG } from "../../src/features/references/config";
import { validateReferenceManifest } from "../../src/references/manifest";

const manifest = validateReferenceManifest();
const report = JSON.parse(await readFile(".reference-build/report.json", "utf8")) as Record<
  string,
  unknown
>;
if (
  report.indexName !== REFERENCE_CONFIG.indexName ||
  report.dimensions !== REFERENCE_CONFIG.dimensions ||
  report.corpusVersion !== REFERENCE_CONFIG.corpusVersion
)
  throw new Error("Reference build configuration does not match the checked-in contract.");
if (
  report.sourcesFailed !== 0 ||
  report.sourcesFetched !== manifest.filter((item) => item.enabled).length
)
  throw new Error("Reference build did not validate every enabled manifest source.");
process.stdout.write(
  `Verified ${String(report.sourcesFetched)} sources for ${REFERENCE_CONFIG.indexName}.\n`,
);
