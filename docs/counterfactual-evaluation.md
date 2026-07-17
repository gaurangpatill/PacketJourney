# Counterfactual evaluation

The deterministic evaluation matrix covers redirect-heavy, cache-miss/origin, slow-origin, large-JavaScript, third-party-heavy, failed-critical-stylesheet, healthy-certificate, and healthy-DNS investigations. Each fixture declares eligible/ineligible scenarios, changed and preserved stages, metric decisions, assumptions, resolved/introduced findings, and forbidden claims.

Core invariants are checked across every rule: source JSON is unchanged, repeat output is stable, source evidence references exist, rule IDs are present, simulation labels cannot disappear, canonical validation succeeds, and unsupported metrics are unavailable rather than estimated.

Frontend checks cover deterministic suggestions, structured editors, invalid inputs, run/reset/history/duplicate behavior, side-by-side graphs, synchronized stage selection, non-color change language, assumptions, metric decisions, JSON export, keyboard controls, reduced motion, and narrow layout. No evaluation requires the public Internet or Workers AI.

The most important failure condition is semantic overreach: a result that invents FCP, execution time, transfer bytes, response status, visual recovery, cache correctness, or resolver behavior fails even if its arithmetic is plausible.
