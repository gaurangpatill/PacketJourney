# AI investigation trust boundary

Layer 6 treats the language model as an untrusted interpreter over bounded data. Deterministic diagnostics and the canonical investigation remain authoritative. The model can neither verify evidence provenance nor acquire capabilities from text inside a website response.

## Inputs and provenance

The diagnosis endpoint accepts a canonical `Investigation` in the request because D1 persistence and signed server records do not exist yet. Zod proves only that the payload has the canonical shape and internally valid IDs; it does not prove the evidence was originally collected by Packet Journey. The path investigation ID must equal the payload ID, but this is consistency rather than authentication.

Every page-derived string is untrusted data: titles, URLs, DNS TXT, HTTP headers, certificate names, errors, console messages, resource names, and inferred vendor labels. A deterministic selector sanitizes, bounds, categorizes, and serializes those values inside a JSON evidence envelope in a user message. Raw evidence is never interpolated into the system policy. Text such as “ignore previous instructions,” “reveal the system prompt,” or “fetch metadata” remains an inert evidence value.

## Capability boundary

The model receives no arbitrary `fetch`, URL argument, browser object, R2 binding, socket, filesystem, secret, environment, code execution, or diagnostic rerun capability. Traditional function calls can name only a fixed registry of read-only selectors over the one validated investigation. The Worker validates tool arguments and executes them. Unknown, malformed, duplicate, excessive, or out-of-investigation calls fail closed.

Layer 6 tools do not rerun HTTP, DNS, TLS, Browser Run, or certificate diagnostics. When selected evidence and approved views do not answer the question, the correct result is an inconclusive diagnosis with named missing evidence.

## Output contract

Model output is untrusted even when JSON Mode is requested. A diagnosis is returned only after:

1. JSON parsing and Zod validation with bounded arrays and strings.
2. Validation that every evidence, deterministic finding, and stage ID exists.
3. Category-to-stage relevance checks for each AI finding.
4. Nonempty evidence references for website-specific findings and actions.
5. Rejection of invented graph operations or unsafe panel names.
6. Cautious-causation checks and explicit uncertainty rules.
7. Sanitization of rendered text and maximum-output enforcement.

Invalid output becomes a structured AI error; partially parsed prose is never rendered. AI findings cannot delete or edit deterministic findings, change metrics, alter status, add graph nodes/edges, or relabel evidence. Graph instructions are transient display suggestions over existing IDs.

## Diagnosis schema

The validated response contains a conclusion type (`supported`, `likely`, `inconclusive`, or `unsupported`), confidence, summary, answer, evidence-linked findings and actions, explicit uncertainties, evidence references, follow-up questions, and bounded graph instructions. Server-controlled metadata adds the question, generation time, model, prompt version, and whether a deterministic fixture produced the response.

`inconclusive` is a successful diagnosis. Narrow intents with no relevant selected evidence are answered by a deterministic insufficiency guard without spending a model request. The response states what is unavailable and what evidence would be required; it does not pad the answer with speculation.

## Prompt injection and causation limitations

Packet Journey does not claim perfect prompt-injection detection. Its protection comes from data/instruction separation, small immutable tool authority, strict arguments, bounded loops, output validation, and no secret-bearing model context. Question validation rejects obvious requests for prompts, secrets, arbitrary code, unrestricted network access, or unrelated work, but capability enforcement remains authoritative.

Semantic correctness cannot be proven mechanically. Prompts require observed/derived/likely/possible/unknown language, and validation rejects common unsupported causal formulations. Evidence IDs prove traceability, not that a model interpreted evidence perfectly. The UI therefore labels AI output, preserves confidence and uncertainty, and leaves deterministic findings visible beside it.

## Privacy and logs

Production logs include request ID, configured model, prompt version, size buckets, tool names/outcomes, latency, safe Gateway log ID, and validation/error category. They exclude full questions, prompts, evidence payloads, console manifests, screenshots, model responses, binding values, and secrets. AI Gateway caching is disabled to avoid cross-investigation reuse. Gateway logging/retention follows account configuration and must be reviewed before production use.
