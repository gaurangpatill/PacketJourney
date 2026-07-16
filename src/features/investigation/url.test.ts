import { describe, expect, it } from "vitest";
import { normalizePublicUrl } from "./url";

describe("normalizePublicUrl", () => {
  it("adds HTTPS to a bare hostname", () => {
    expect(normalizePublicUrl("example.com/path")).toEqual({
      ok: true,
      normalizedUrl: "https://example.com/path",
    });
  });

  it("preserves HTTP and removes fragments", () => {
    expect(normalizePublicUrl("http://example.com/page#section")).toEqual({
      ok: true,
      normalizedUrl: "http://example.com/page",
    });
  });

  it.each([
    ["", "Enter a public website URL."],
    ["file:///etc/passwd", "Only HTTP and HTTPS URLs can be investigated."],
    ["http://localhost", "Enter a complete public hostname, such as example.com."],
    ["https://user:secret@example.com", "URLs containing credentials are not accepted."],
  ])("rejects %s", (input, message) => {
    expect(normalizePublicUrl(input)).toEqual({ ok: false, message });
  });
});
