# Counterfactual debugging contract

Layer 7 runs a pure, synchronous TypeScript engine over one runtime-validated canonical investigation. It has no Worker endpoint, network access, browser binding, AI call, R2 access, persistence, or expression evaluator.

```text
observed Investigation → validated narrow scenario → versioned registry rule
→ immutable simulated Investigation → reference validation
→ changes + assumptions + metric decisions → comparison adapter/UI/export
```

The source is cloned before transformation and returned separately as `observed`. The simulated investigation carries `simulation.isSimulated: true`, source/scenario/rule/engine identifiers, and the permanent label `SIMULATED · NOT MEASURED`. Stages, evidence, and findings affected or created by a rule carry corresponding metadata. Expertise and UI state cannot remove that label.

## Result model

A result contains the scenario, source ID, observed and simulated investigations, exhaustive changed-value records, explicit assumptions, recalculated/unchanged/unavailable metric decisions, resolved observed finding IDs, simulated findings, a bounded summary, deterministic generation timestamp, and engine version. Every change cites its rule and existing source evidence where evidence is required. The engine rejects dangling IDs after transformation.

`generatedAt` comes from the scenario metadata rather than the system clock, so identical validated inputs produce stable output. The UI creates scenario IDs/timestamps; the engine never introduces nondeterminism.

## Metrics policy

- **Recalculated:** supported arithmetic over measured sequential duration, known resource counts, or complete known transfer bytes.
- **Unchanged:** independent values a rule does not affect, such as DNS duration during origin optimization.
- **Unavailable:** any plausible downstream effect without a deterministic model, including FCP/LCP after transfer/dependency changes, JavaScript execution cost, visual recovery, new server timing, and user-perceived responsiveness.

Unavailable fields are removed from the simulated metric object and retained in the metric-decision list with their observed value and reason. Zero is never used as a substitute for unknown.

## Session and export boundary

The workspace retains at most five results in React memory, suppresses duplicate scenarios, and clears them on reload. It never uses localStorage. Export is bounded JSON containing IDs, scenario/rule/engine metadata, changes, assumptions, metric decisions, simulated findings, and timestamps. It excludes screenshot bytes, raw R2 keys, hidden configuration, prompts, secrets, and unbounded manifests.

Layer 8 can explicitly persist one selected, fully validated result alongside its observed snapshot. It preserves the engine version, source investigation ID/hash, immutable observed/simulated payloads, and deterministic provenance. Saving does not rerun the rule, and public inclusion is controlled per share. Durable Objects should be introduced only when synchronized viewers or another measured real-time coordination requirement exists.
