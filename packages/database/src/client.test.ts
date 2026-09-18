import { describe, expect, it } from "vitest";
import { usesTransactionPooler } from "./client.js";

describe("usesTransactionPooler", () => {
  it("detects the Supabase transaction pooler", () => {
    expect(usesTransactionPooler(
      "postgresql://postgres.project:secret@aws-0-region.pooler.supabase.com:6543/postgres"
    )).toBe(true);
  });

  it("does not disable prepared statements for direct or session connections", () => {
    expect(usesTransactionPooler(
      "postgresql://postgres:secret@db.project.supabase.co:5432/postgres"
    )).toBe(false);
    expect(usesTransactionPooler(
      "postgresql://postgres.project:secret@aws-0-region.pooler.supabase.com:5432/postgres"
    )).toBe(false);
    expect(usesTransactionPooler("postgres://take:take@localhost:5432/take")).toBe(false);
  });
});
