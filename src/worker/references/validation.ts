import type { AiDiagnosis } from "../../features/investigation/aiSchema";
import { REFERENCE_CONFIG } from "../../features/references/config";
import type { ReferenceCitation } from "../../features/references/schema";
import { referenceManifestById } from "../../references/manifest";

export function validateFrozenCitation(citation: ReferenceCitation): ReferenceCitation {
  const source = referenceManifestById.get(citation.sourceId);
  if (
    !source?.enabled ||
    source.publisher !== citation.publisher ||
    source.category !== citation.category ||
    source.documentTitle !== citation.title ||
    source.canonicalUrl !== citation.canonicalUrl ||
    citation.corpusVersion !== REFERENCE_CONFIG.corpusVersion
  ) {
    throw new Error("The citation does not match an enabled allowlisted reference source.");
  }
  return citation;
}

export function validateDiagnosisReferences(diagnosis: AiDiagnosis): void {
  const citationIds = new Set<string>();
  for (const citation of diagnosis.referenceCitations) {
    validateFrozenCitation(citation);
    if (citationIds.has(citation.citationId)) throw new Error("Duplicate reference citation.");
    citationIds.add(citation.citationId);
  }
  for (const reference of diagnosis.technicalReferences) {
    if (!citationIds.has(reference.citationId)) {
      throw new Error("The diagnosis cited a technical reference outside its frozen snapshot.");
    }
  }
  if (diagnosis.retrievalMetadata) {
    if (!diagnosis.retrievalMetadata.controlledQuery || !diagnosis.retrievalMetadata.questionHash) {
      throw new Error("A saved diagnosis requires complete private retrieval provenance.");
    }
    if (diagnosis.retrievalMetadata.selectedCount !== diagnosis.referenceCitations.length) {
      throw new Error("The retrieval selection count does not match its frozen citations.");
    }
  } else if (diagnosis.referenceCitations.length || diagnosis.technicalReferences.length) {
    throw new Error("Technical citations require retrieval provenance.");
  }
}
