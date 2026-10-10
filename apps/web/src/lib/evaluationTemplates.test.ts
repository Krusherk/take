import { describe, expect, it } from "vitest";
import { EVALUATION_TEMPLATES, chainName, templatePreset } from "./evaluationTemplates";

describe("evaluation templates", () => {
  it("prefills a question for each opportunity type", () => {
    expect(templatePreset("BUILDER_GRANT").question).toBe("Did they ship?");
    expect(templatePreset("CREATOR_PROGRAM", { pieces: 4 }).question).toBe("Did they publish 4 pieces?");
    const nft = templatePreset("NFT_HOLD", { holdDays: 14 });
    expect(nft.question).toBe("Did they still hold the NFT 14 days after mint?");
    expect(nft.evidenceExpected).toBe(false);
    expect(nft.criteria).toContain("balanceOf");
    expect(templatePreset("EVENT_TICKET").question).toBe("Did they attend?");
    expect(Object.keys(EVALUATION_TEMPLATES)).toHaveLength(6);
    expect(chainName(10143)).toBe("Monad testnet");
  });
});

describe("evaluationDate", () => {
  it("adds days to the base and never lands before the campaign end", async () => {
    const { evaluationDate } = await import("./evaluationTemplates");
    const end = new Date("2026-10-20T10:00:00Z");
    expect(evaluationDate(end, 30, end).toISOString()).toBe("2026-11-19T10:00:00.000Z");
    expect(evaluationDate(new Date("2026-10-01T10:00:00Z"), 5, end).toISOString()).toBe(end.toISOString());
  });
});
