# Authoritative reference retrieval

Layer 9 adds one narrowly scoped retrieval operation inside the existing diagnosis endpoint. It does not add a search API, crawler, upload surface, autonomous agent, or documentation chatbot.

## Trust order

```text
observed investigation evidence
→ deterministic findings
→ validated authoritative references
→ AI interpretation
```

References explain standards, product/runtime behavior, and recommended practices. They never prove what the investigated website returned or caused. Website-specific claims continue to cite evidence IDs; technical explanations cite supplied reference IDs.

## Configuration locked before index creation

| Axis                | Value                                                |
| ------------------- | ---------------------------------------------------- |
| Binding             | `TECHNICAL_REFERENCES`                               |
| Index               | `packet-journey-references-v1`                       |
| Index version       | `references-v1`                                      |
| Embedding model     | `@cf/qwen/qwen3-embedding-0.6b`                      |
| Dimensions          | 1,024                                                |
| Metric              | cosine                                               |
| Corpus              | `2026-07-v1`                                         |
| Retrieval algorithm | `reference-retrieval-v1`                             |
| Namespace           | `technical-references`                               |
| Indexed metadata    | `publisher`, `category`, `corpusVersion`, `language` |

Cloudflare documents Qwen3 Embedding 0.6B with 1,024 output dimensions, cosine use, and batch input. The model page and April 2026 release table currently disagree on the maximum input context (8,192 versus 4,096 tokens), so Packet Journey does not depend on either ceiling: chunks are capped at 1,800 characters and the controlled query at 1,200. Index dimensions and metric cannot be changed, so an incompatible model change creates a new versioned index and corpus embedding rather than mutating this contract.

Vectorize stores embeddings plus compact metadata. D1 stores normalized source/chunk content and is the lookup and provenance ledger. The model never receives an unresolved Vectorize match.

## Filtering and ranking

Question intent maps deterministically to categories and, for Cloudflare-runtime questions, a publisher constraint. The query builder combines sanitized question terms, relevant evidence labels/values, deterministic findings, expertise mode, and recorded runtime limitations. It removes URL query/fragment data and control characters. The model cannot write filters.

Vector similarity supplies 70% of the documented deterministic rerank score. Category match supplies 10%, protocol/evidence term overlap 10%, category-specific authority 7%, and source diversity 3%. Duplicate content hashes, adjacent overlap, more than two chunks per source, and the total 6,000-character context bound are enforced before selection. Initial retrieval requests 12 candidates, requires similarity 0.62, and selects at most four.

## Failure behavior

Evidence-only mode never touches Vectorize. In authoritative mode, missing bindings, embedding failure, Vectorize failure, unresolved D1 rows, invalid hashes, stale corpus data, irrelevant scores, or an empty selection produce an explicit retrieval status. The evidence-grounded AI answer still runs without references. No threshold relaxation, generic web search, AI Search, or unapproved source fallback occurs.

## Version and security boundary

The migration, investigation snapshot, AI prompt/model, embedding model, Vectorize index, corpus, retrieval algorithm, and counterfactual engine versions remain independent. Reference text is untrusted data inside a dedicated prompt delimiter and cannot modify tools or policies. Saved diagnoses freeze the selected citation title, canonical URL, heading, excerpt, source/content versions, hashes, ranks, scores, and retrieval configuration in D1; reopening or sharing them requires neither Vectorize nor the current corpus.
