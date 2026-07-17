# Data retention

Saved investigation rows have no automatic expiration in Layer 8 and remain until the anonymous owner deletes them. Share links may expire sooner and can always be revoked. This is a product-retention choice, not proof of regulatory compliance.

Saving promotes an available Layer 5 screenshot from `browser-screenshots/<artifact>.image` into the private `saved-artifacts/<saved-investigation>/<artifact>.image` namespace with a 30-day metadata expiry. The saved snapshot receives an artifact association only after the copy succeeds. If promotion fails, the investigation is saved without that screenshot and the API/UI reports an explicit partial-artifact warning; it never claims preservation.

Owner and shared routes reject expired saved artifacts even if lifecycle deletion has not physically run. Production R2 must configure a lifecycle rule for the saved prefix. Investigation deletion cascades metadata and deletes exclusive R2 objects; cleanup failure is logged and recorded for repair.

D1 does not store screenshot bytes, raw share tokens, cookie values, raw prompts, cookies from investigated sites, authentication headers, browser local storage, raw HTML, or Worker stacks. Temporary Layer 5 artifact URLs are stripped from snapshot JSON.
