# AI evaluation

Layer 6 evaluation is structural and evidence-grounded rather than a claim of universal diagnostic accuracy.

The deterministic suite covers all seven seeded journey shapes and checks schema validity, known evidence/stage/finding references, explicit source labels, bounded context/output, stable selection, and inconclusive behavior when relevant evidence is absent. Focused fixtures cover cache, DNS, TLS, redirects, browser timing/resources/failures, third parties, security, broad prioritization, unsupported questions, malformed JSON, invented IDs, category-mismatched citations, excess tools, unknown tools, timeouts, rate/Gateway failures, disabled/missing bindings, and fixture-mode gating.

Prompt-injection strings are placed in page-title, DNS TXT, HTTP-header, console, resource-URL, certificate-organization, and error fields. Tests verify that they remain inside the `UNTRUSTED_INVESTIGATION_EVIDENCE_NOT_INSTRUCTIONS` envelope and cannot create a network or code-execution tool.

Primary tests use deterministic fake model responses and never require internet/model availability. A production-readiness smoke should make one real Workers AI request through AI Gateway, verify a Gateway log/latency event, inspect the validated diagnosis, and confirm that cache is skipped. That smoke is environment-dependent and must be reported separately rather than folded into deterministic pass counts.

Evaluation favors abstention. A concise `inconclusive` answer with named missing evidence passes; a polished but unsupported causal diagnosis fails.

Layer 9 adds a separate 15-case reference retrieval evaluation. It checks deterministic category filters, preferred authoritative publishers, required concepts, prohibited site-specific overclaims, stable reranking, duplicate/source limits, invalid embedding dimensions, explicit unavailability, allowlist identity, and invented citation rejection. Reference-grounded output must still cite investigation evidence for website claims; retrieving a relevant standard never increases the confidence of the underlying measurement.

Fixture scores are deterministic test signals. Production readiness additionally requires one real embedding, Vectorize query, D1 resolution, grounded diagnosis, saved citation, and shared frozen snapshot using the exact deployed index/corpus versions. That external smoke is reported separately and is never inferred from fixture success.
