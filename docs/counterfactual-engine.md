# Counterfactual engine

Counterfactual debugging is a deterministic transformation of a completed investigation. Each scenario declares prerequisites, graph transformations, metric calculation rules, assumptions, and affected evidence IDs.

Simulations produce a separate runtime-validated investigation labeled `SIMULATED · NOT MEASURED`. They do not mutate or masquerade as measurements. The fixed registry contains eight versioned rules; unknown transformations and invalid targets fail closed. Every result carries changes, source evidence IDs, assumptions, resolved findings, simulated findings, and an explicit recalculated/unchanged/unavailable policy for each metric.

The engine runs as pure synchronous TypeScript in the Layer 7 client. It has no network or storage capability. AI may explain the completed simulated investigation after rules run, but it cannot create a scenario or generate values. See [counterfactual-debugging.md](./counterfactual-debugging.md), [counterfactual-rules.md](./counterfactual-rules.md), and [counterfactual-evaluation.md](./counterfactual-evaluation.md).
