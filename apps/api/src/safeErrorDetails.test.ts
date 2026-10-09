import { describe, expect, it } from "vitest";
import { safeErrorDetails } from "./app.js";

describe("safeErrorDetails", () => {
  it("keeps codes and strips URLs and keys", () => {
    const error = new Error("Failed query: select 1", { cause: Object.assign(new Error("connect to postgres://u:p@db.example:5432/x failed, key=abc 0x" + "a".repeat(64)), { code: "XX000" }) });
    const details = safeErrorDetails(error);
    expect(details.cause1code).toBe("XX000");
    expect(JSON.stringify(details)).not.toMatch(/u:p@|abc|aaaa/);
  });
});
