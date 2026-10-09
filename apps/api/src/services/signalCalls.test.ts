import { describe, expect, it } from "vitest";
import { callWindow, isMissingCallsTable, splitCalls } from "./signalCalls.js";

describe("signal calls", () => {
  const check = new Date("2026-11-30T12:00:00.000Z");
  it("stays open until the check date, and closes for people who were not chosen", () => {
    expect(callWindow(check, null, new Date("2026-11-01T00:00:00.000Z"))).toEqual({ open: true, closesAt: check.toISOString() });
    expect(callWindow(check, true, new Date("2026-12-01T00:00:00.000Z")).open).toBe(false);
    expect(callWindow(check, false, new Date("2026-11-01T00:00:00.000Z")).open).toBe(false);
    expect(callWindow(null, true)).toEqual({ open: false, closesAt: null });
  });
  it("splits calls for one recipient only", () => {
    const rows = [{ recipientKey: "0xa", call: "YES" }, { recipientKey: "0xa", call: "NO" }, { recipientKey: "0xa", call: "YES" }, { recipientKey: "0xb", call: "UNSURE" }];
    expect(splitCalls(rows, "0xa")).toEqual({ yes: 2, unsure: 0, no: 1, total: 3 });
  });
  it("recognizes the missing table before migration 0014 runs", () => {
    expect(isMissingCallsTable({ code: "42P01" })).toBe(true);
    expect(isMissingCallsTable(new Error("wrapped", { cause: { code: "42P01" } }))).toBe(true);
    expect(isMissingCallsTable({ code: "23505" })).toBe(false);
  });
});
