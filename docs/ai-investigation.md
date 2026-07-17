# AI investigation

## Request lifecycle

`POST /api/v1/investigations/:investigationId/diagnose` accepts one validated canonical `Investigation`, a 4–500 character question, expertise mode, optional selected stage, and `referenceMode` (`none` or `authoritative`). The path and payload IDs must match. Schema validity is not proof of server provenance.

```text
question validation → deterministic intent → bounded evidence selection
→ optional Workers AI tool planning through AI Gateway
→ application-owned read-only tools → structured diagnosis inference
→ Zod and cross-reference validation → assistant panel and graph emphasis
```

Authoritative mode inserts a bounded retrieval step before final inference: deterministic query/filter → Workers AI embedding → Vectorize → D1 chunk resolution → citation validation/rerank. Evidence-only mode does not touch Vectorize. Failure or no-result preserves the evidence-only answer and exposes the retrieval state.

The existing network endpoint is unchanged. AI never re-runs HTTP, DNS, TLS, certificate, Browser Run, or R2 work and cannot send an arbitrary URL.

## Runtime configuration

- `AI` is the Wrangler Workers AI binding.
- `AI_ENABLED=false` disables only diagnosis.
- `AI_GATEWAY_ID` defaults to `default`.
- `AI_MODEL` defaults to the `llama-3.3-70b-fast` registry key.
- `AI_FALLBACK_MODEL` is reserved configuration; no silent fallback runs in Layer 6.
- `AI_MAX_REQUESTS`, `AI_MAX_TOOL_ROUNDS`, `AI_MAX_INPUT_CHARS`, `AI_MAX_OUTPUT_CHARS`, `AI_MAX_OUTPUT_TOKENS`, and `AI_TIMEOUT_MS` accept bounded overrides.
- `AI_FIXTURE_MODE=true` selects deterministic output only when `ENVIRONMENT` is `development` or `test`; preview and production cannot enable it.
- `TECHNICAL_REFERENCES` binds the versioned 1,024-dimension cosine index. Reference model/index/corpus/retrieval versions are explicit Wrangler variables and response provenance.

`npm run dev` uses `wrangler.local.jsonc`, which intentionally omits the always-remote AI binding and enables fixture mode, so local UI/API work needs no Cloudflare credentials. Fixture answers are visibly labeled `LOCAL FIXTURE` and never presented as model output. `npm run dev:worker:ai` uses the production-shaped config to exercise real Workers AI; set `AI_FIXTURE_MODE=false` if `.dev.vars` overrides it. Wrangler account authentication and Workers AI availability are required, but the application uses no model API key.

## Cost and abuse limits

The app makes at most two model requests: one optional tool-planning request and one diagnosis. It permits one tool round and four total tools. Native bindings separately limit a coarse client key to eight diagnoses/minute and an investigation-payload hash to three/minute per Cloudflare location. These are abuse brakes, not identity, billing, or exact distributed quotas.

## Interface

The assistant is a compact workspace panel, not a chat transcript. Suggested questions are deterministic. Responses separate observed evidence, technical reference cards, and AI interpretation; the provenance disclosure shows AI/prompt, embedding, retrieval, corpus, and index versions. Evidence links select the corresponding node and inspector item. Cancel aborts the client request; Worker inference cancellation remains subject to runtime behavior.

Beginner, Developer, and Network Engineer modes change prompt depth and presentation, never the evidence or graph topology.

## Known limitations

- A submitted canonical payload may be fabricated by its client. Layer 8 persistence validates shape and consistency but does not sign or attest collection provenance.
- Model output remains probabilistic even after validation; validation prevents dangling references, not every semantic error.
- JSON Mode does not guarantee schema compliance, so failures are expected and handled.
- Gateway observability can retain configured request data; production account settings require review.
- Vector retrieval can miss relevant passages or rank imperfect ones. All source text is delimited untrusted input and cannot prove site behavior.
- A user can explicitly include one selected validated diagnosis in a saved snapshot. D1 stores the structured diagnosis and version metadata, never system prompts or Gateway logs. Public inclusion is separately controlled per share.
- AI Search, Durable Objects, Queues, full authentication, collaboration, and organizations are not implemented.
