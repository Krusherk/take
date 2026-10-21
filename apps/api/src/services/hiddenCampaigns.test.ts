import { describe, expect, it } from "vitest";
import { loadApiEnv } from "../config/env.js";
import { DEFAULT_HIDDEN_CAMPAIGN_IDS, parseHiddenCampaignIds, withoutHiddenCampaigns } from "./hiddenCampaigns.js";

const TAKE_DEMO = "30e8b781-9143-4b84-8905-eadf13b92029";
const JUDGE_SANDBOX = "d536318a-5ce6-4fc1-b0a8-78e2c1b670b7";

describe("hidden campaigns", () => {
  it("hides TAKE Demo by default and never the judge campaign", () => {
    expect(parseHiddenCampaignIds(undefined)).toEqual([TAKE_DEMO]);
    expect(parseHiddenCampaignIds("")).toEqual([TAKE_DEMO]);
    expect(DEFAULT_HIDDEN_CAMPAIGN_IDS).not.toContain(JUDGE_SANDBOX);
    const list = [{ id: JUDGE_SANDBOX }, { id: TAKE_DEMO }, { id: "other" }];
    expect(withoutHiddenCampaigns(list, parseHiddenCampaignIds(undefined))).toEqual([{ id: JUDGE_SANDBOX }, { id: "other" }]);
  });

  it("reads a comma-separated override, case-insensitively, and 'none' hides nothing", () => {
    expect(parseHiddenCampaignIds(" A , b,,a ")).toEqual(["a", "b"]);
    expect(withoutHiddenCampaigns([{ id: "A" }, { id: "c" }], parseHiddenCampaignIds("a"))).toEqual([{ id: "c" }]);
    expect(parseHiddenCampaignIds("none")).toEqual([]);
    expect(withoutHiddenCampaigns([{ id: TAKE_DEMO }], [])).toEqual([{ id: TAKE_DEMO }]);
  });

  it("is wired into the API env", () => {
    const base = { DATABASE_URL: "postgres://user:pass@localhost:5432/take" };
    expect(loadApiEnv(base).HIDDEN_CAMPAIGN_IDS).toEqual([TAKE_DEMO]);
    expect(loadApiEnv({ ...base, HIDDEN_CAMPAIGN_IDS: "none" }).HIDDEN_CAMPAIGN_IDS).toEqual([]);
  });
});
