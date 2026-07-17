// @vitest-environment node
import { describe, expect, it } from "vitest";
import { collectAllowedHeaders } from "./headers";

describe("response header collection", () => {
  it("keeps allowlisted evidence and excludes sensitive headers", () => {
    const collected = collectAllowedHeaders(
      new Headers({
        "cache-control": "public, max-age=300",
        server: "example",
        "set-cookie": "session=secret",
        authorization: "Bearer secret",
        "x-unrelated": "discard",
      }),
    );

    expect(collected.values).toEqual({
      "cache-control": "public, max-age=300",
      server: "example",
    });
    expect(collected.values).not.toHaveProperty("set-cookie");
    expect(collected.truncated).toBe(false);
  });

  it("bounds individual allowlisted values", () => {
    const collected = collectAllowedHeaders(
      new Headers({ "content-security-policy": "a".repeat(5_000) }),
    );

    expect(collected.values["content-security-policy"]).toHaveLength(4_096);
    expect(collected.truncated).toBe(true);
  });
});
