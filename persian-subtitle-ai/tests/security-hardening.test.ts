import { describe, expect, it } from "vitest";
import { sanitizeRequestId } from "../apps/worker/src/security/request-id.js";

describe("security hardening", () => {
  it("accepts bounded request IDs and rejects unsafe values", () => {
    expect(sanitizeRequestId("req-123_ABC:1")).toBe("req-123_ABC:1");
    expect(sanitizeRequestId("\nforged-log-entry")).toBeNull();
    expect(sanitizeRequestId("a".repeat(129))).toBeNull();
  });
});
