import { describe, expect, it } from "vitest";
import { isValidOpaqueToken, randomToken, sha256Hex } from "./crypto";

describe("opaque share tokens", () => {
  it("creates 256-bit base64url tokens and stores a deterministic hash", async () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isValidOpaqueToken(token)).toBe(true);
    expect(await sha256Hex(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex(token)).not.toContain(token);
  });

  it("creates independent tokens", () => {
    expect(randomToken()).not.toBe(randomToken());
  });

  it("rejects guessable, malformed, and oversized tokens", () => {
    expect(isValidOpaqueToken("shared-report-1")).toBe(false);
    expect(isValidOpaqueToken("a".repeat(43))).toBe(true);
    expect(isValidOpaqueToken(`${"a".repeat(42)}!`)).toBe(false);
    expect(isValidOpaqueToken("a".repeat(44))).toBe(false);
  });
});
