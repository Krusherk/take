import { describe, expect, it } from "vitest";
import { isMissingTable } from "./campaign.js";

describe("isMissingTable", () => {
  it("recognises an undefined table, also when wrapped by the query builder", () => {
    expect(isMissingTable({ code: "42P01" })).toBe(true);
    expect(isMissingTable(new Error("Failed query", { cause: { code: "42P01" } }))).toBe(true);
    expect(isMissingTable({ code: "23505" })).toBe(false);
    expect(isMissingTable(new Error("boom"))).toBe(false);
  });
});
