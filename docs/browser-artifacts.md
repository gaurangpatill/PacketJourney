# Browser artifacts

Layer 5 stores only rendered-page screenshot bytes in Cloudflare R2. Resource, timing, console, error, and finding data remains bounded canonical JSON. R2 is justified because embedding an image in the API response would inflate and retain investigation payloads; it is not used as general persistence.

## Storage model

The Worker generates a version-4 UUID and derives the private object key internally:

```text
browser-screenshots/{opaque-id}.image
```

The investigated URL is never an object key and is not stored in R2 object metadata. A write includes only content type, capture time, readiness, and an expiry timestamp. Screenshot output uses a fixed viewport, JPEG compression, disabled animations, a hidden caret, and a 1.5 MB maximum. The screenshot records what the isolated browser could render at capture time; it may represent a partial load and is labeled with readiness.

The canonical investigation receives metadata only: opaque artifact ID, type, label, storage class, safe content type, byte size, creation/expiry time, access mode, description, and a Worker-mediated relative URL. Raw bytes and internal R2 keys never enter investigation JSON.

## Read boundary

R2 buckets remain private. The only public artifact operation is:

```text
GET or HEAD /api/v1/artifacts/screenshots/{uuid}
```

The route validates the UUID shape, derives the internal prefix itself, performs one exact object read, and never accepts a raw key. There are no list, upload, overwrite, delete, or arbitrary-bucket routes. Invalid and missing IDs return the same not-found shape. Expired objects return `410` and their body is not sent.

Successful responses set the stored image media type, `X-Content-Type-Options: nosniff`, a sandboxed content security policy, private short caching, a fixed inline filename, length, and ETag. CORS applies only through the existing exact frontend-origin allowlist. Artifact URLs are bearer-style opaque references in Layer 5; authentication and organization authorization remain unimplemented and must be added before screenshots can be considered user-private data.

Layer 8 adds a second read boundary for explicitly saved screenshots. A save copies an available transient object to `saved-artifacts/{saved-investigation-id}/{artifact-id}.image`, records the association in D1, and exposes it only after owner-cookie authorization or resolution of an active share whose policy includes screenshots. Neither route accepts an R2 key. This is installation/share authorization, not full account authentication.

## Retention and privacy

The Worker enforces a 24-hour access expiry in object metadata. Preview and production buckets should also configure an R2 lifecycle rule that deletes the `browser-screenshots/` prefix after one day, preventing inaccessible bytes from accumulating. Local Wrangler uses simulated R2.

Saved screenshot metadata and reads are bounded to 30 days. Production should apply a matching lifecycle rule to `saved-artifacts/`. Deleting a saved investigation deletes its exclusive saved objects after the D1 cascade; failed object cleanup is logged and recorded for later repair.

Screenshots can contain public-page content visible to an unauthenticated new browser context. Packet Journey never forwards user cookies, credentials, local storage, or authentication. Users should still treat artifact links as sensitive during their lifetime because a public page can reflect URL-path or server-derived information. Display URLs remove query strings and fragments; screenshots themselves necessarily show rendered content and are not logged or committed as test fixtures.

## Failure behavior

Missing R2, an oversized screenshot, capture failure, write failure, expiry, and retrieval failure are structured states. Browser timing/resource evidence and all earlier network evidence remain available. The interface deliberately shows a screenshot-unavailable panel instead of a broken image and never substitutes a recorded screenshot for a live failure.

## Testing

Fixture tests cover successful writes, safe UUID-derived keys, size limits, missing bindings, failed writes, metadata-only API output, safe retrieval headers, invalid IDs, missing objects, expiry, and absence of unrestricted artifact operations. No fixture contains a private screenshot.

## AI boundary

Layer 6 does not send screenshot bytes, artifact object keys, or image contents to Workers AI or AI Gateway. The selector may include bounded artifact-independent browser metadata already present as evidence. The AI tool registry has no R2 binding and cannot retrieve screenshot routes. Evidence navigation may open the existing screenshot panel only through validated presentation instructions.
