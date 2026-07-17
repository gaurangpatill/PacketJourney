# Counterfactual rule registry

Each scenario has a fixed rule ID/version, required evidence, eligibility checks, deterministic transformation, metric policy, and assumptions. Unknown types and unrestricted edits are rejected.

| Scenario                 | Rule                              | Deterministic effect                                                                                                                   | Explicitly unavailable                                                |
| ------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Remove redirects         | `redirect.remove.v1`              | Removes verified selected redirect stages, reconnects neighbors, subtracts measured redirect duration, resolves redirect-only findings | Direct-destination browser behavior and dependent paint               |
| Edge-cache HTML          | `cache.edge-html.v1`              | Converts cache path to simulated hit, bypasses origin active path, subtracts measured origin work                                      | Personalization/correctness, new TTFB/paint/server timing             |
| Reduce origin            | `origin.duration.v1`              | Sets a verified stage to a bounded lower duration and adjusts sequential total                                                         | FCP/LCP/load and internal origin cause                                |
| Reduce JavaScript        | `resource.javascript-transfer.v1` | Reduces known script bytes and total transfer only when complete                                                                       | Parse/execution cost and paint/user responsiveness                    |
| Remove third party       | `third-party.remove.v1`           | Removes one existing dependency group and known resources/count/bytes                                                                  | Functional/visual equivalence and indirect effects                    |
| Resolve critical failure | `resource.failure-resolve.v1`     | Changes one verified failed document/script/stylesheet to simulated success and resolves its direct finding                            | Status, bytes, timing, and actual recovery                            |
| Expire certificate       | `tls.expire.v1`                   | Adds simulated expired evidence/finding, terminates at TLS, marks later stages unreachable                                             | Exact behavior of every client and fetch-session certificate identity |
| Remove DNS addresses     | `dns.address-remove.v1`           | Adds simulated no-address evidence/finding, terminates at DNS, marks later stages unreachable                                          | Resolver-specific caching/fallback behavior                           |

Removing redirects never removes distinct-host DNS/TLS stages automatically. Edge caching never claims the observed response is actually cacheable. Resource scenarios require normalized browser evidence; simple display-only fixture stages may be eligible only when their evidence supplies the necessary bounded values.

AI is not part of the registry. It may describe a completed result or suggest one registered type with evidence and user confirmation, but cannot invoke a rule, set inputs, generate values, or edit output.
