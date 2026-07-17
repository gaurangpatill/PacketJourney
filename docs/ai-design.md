# AI design

Packet Journey treats AI as an untrusted interpreter, not a network sensor. Deterministic diagnostics collect facts, deterministic rules remain authoritative, and the model may only prioritize, connect, and explain canonical evidence.

The versioned `packet-journey-ai-v1` prompt separates system policy, task instruction, the user question, an explicitly untrusted JSON evidence envelope, approved tool definitions, and the output schema. Page-derived strings never enter the system message. JSON Mode is an output hint only: every result is parsed, runtime validated, cross-checked against actual evidence/stage/finding IDs, checked for category relevance and overclaimed causation, and rejected as a whole on failure.

## Model and Gateway

The default registry entry is `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. At implementation time Cloudflare documents a 24,000-token context, function calling, and JSON Mode support. Packet Journey selects it for its context capacity and structured/tool capabilities, not because it is universally best. `AI_MODEL` selects a registry key; model IDs do not appear across feature code. The optional fallback is configuration-ready but is not automatically used in Layer 6 because the two-request planning/diagnosis budget must stay explicit.

Both planning and diagnosis use the Workers AI binding and the supported `gateway` option on `env.AI.run`. Gateway ID, prompt version, and model key are bounded metadata; logging and latency/error visibility come from AI Gateway. `skipCache: true` prevents an evidence-bearing answer from being reused across investigations. Retries are limited to one attempt. Account Gateway retention and logging settings must be reviewed before production use.

## Evidence and tools

The selector ranks selected-stage, question-intent, warning/error, deterministic-finding, verified, and measured-duration evidence. It retains at most 30 evidence items, eight per category, 12 deterministic findings, 15 resource entries, eight console entries, bounded nesting/keys/strings, and 18,000 serialized characters. Omitted evidence/resource counts and limitations stay visible to the model. Screenshots, raw HTML, cookies, credentials, complete manifests, and arbitrary headers are excluded.

Traditional function calling is used for at most one planning round and four calls. The application—not the model—executes a fixed read-only registry over the already submitted investigation: summary, stage evidence, related findings, resource group, failed requests, console errors, cache/DNS/TLS evidence, browser metrics, and stage-duration comparison. Tools cannot fetch, browse, execute code, access bindings, mutate evidence, or create graph topology. Unknown tools, invalid/out-of-scope arguments, duplicates, oversized output, and excess calls fail closed.

## Conclusions and failures

The strict diagnosis schema distinguishes `supported`, `likely`, `inconclusive`, and `unsupported`. Website-specific findings and actions require real evidence IDs; graph instructions may only select, emphasize, or dim existing IDs. Inconclusive confidence cannot exceed 0.5 and unsupported confidence cannot exceed 0.2. The UI shows deterministic findings separately and never overwrites them.

Missing relevant evidence returns a successful deterministic evidence-guard answer without spending an AI request. Missing bindings, timeouts, Gateway/rate-limit failures, invalid JSON/schema/references, unsupported tools, and refusals return structured assistant errors while the graph, evidence, deterministic findings, and browser artifacts remain usable. See [ai-investigation.md](./ai-investigation.md), [ai-trust-boundary.md](./ai-trust-boundary.md), and [ai-evaluation.md](./ai-evaluation.md).
