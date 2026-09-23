import { describe, expect, it } from "vitest";
import { planSplits, planSplitsAsync, splitCandidates } from "./splitQuery.js";
import { SplitRepository } from "./splitRepository.js";

const repository = SplitRepository.fromLines([
  "#ANY-S 00000",
  "0NRWDISLST",
  "2SMKIPS",
  "#ANY-S 00700",
  "0NRWIPSCOL"
]);

const anyPermitted: Record<string, number> = {
  NRWLST: 8890, NRWDIS: 550, DISLST: 6000, DISSMK: 400, SMKLST: 5000, NRWSMK: 1200, NRWIPS: 1900, IPSLST: 5000,
  SMKIPS: 400, DISIPS: 1300
};
const routeFares: Record<string, number> = {"IPSLST:00700": 3000};

const withRoutes = (from: string, to: string, route: string) =>
  Math.min(anyPermitted[from + to] ?? Infinity, routeFares[`${from}${to}:${route}`] ?? Infinity);
const anyPermittedOnly = (from: string, to: string) => anyPermitted[from + to] ?? Infinity;

const JOURNEY = ["NRW", "DSM", "DIS", "SMK", "IPS", "COL", "LST"];

describe("splitCandidates", () => {

  it("keeps the ends and the split points between calling points, by route, with any permitted ones in every route", () => {
    expect(splitCandidates(repository, "ANY-S", JOURNEY)).toEqual(new Map([
      ["00000", ["NRW", "DIS", "SMK", "LST"]],
      ["00700", ["NRW", "DIS", "SMK", "IPS", "LST"]]
    ]));
  });

  it("ignores split points the journey does not call at", () => {
    expect(splitCandidates(repository, "ANY-S", ["NRW", "COL", "LST"])).toEqual(new Map([["00000", ["NRW", "LST"]]]));
  });

});

describe("planSplits", () => {

  it("prices each route's candidates with its fares and picks the cheapest", () => {
    expect(planSplits(repository, "ANY-S", JOURNEY, withRoutes)).toEqual({
      route: "00700",
      segments: [[["NRW", "DIS"], 550], [["DIS", "SMK"], 400], [["SMK", "IPS"], 400], [["IPS", "LST"], 3000]]
    });
  });

  it("keeps to any permitted tickets when no route is cheaper", () => {
    expect(planSplits(repository, "ANY-S", JOURNEY, anyPermittedOnly)).toEqual({
      route: "00000",
      segments: [[["NRW", "DIS"], 550], [["DIS", "SMK"], 400], [["SMK", "LST"], 5000]]
    });
  });

  it("returns the through ticket when nothing splits", () => {
    expect(planSplits(repository, "ANY-S", ["NRW", "LST"], withRoutes)).toEqual({route: "00000", segments: [[["NRW", "LST"], 8890]]});
  });

  it("returns undefined when the journey cannot be covered", () => {
    expect(planSplits(repository, "ANY-S", ["NRW", "XXX"], withRoutes)).toBeUndefined();
  });

  it("works with fares looked up asynchronously", async () => {
    expect(await planSplitsAsync(repository, "ANY-S", JOURNEY, async (from, to, route) => withRoutes(from, to, route))).toEqual({
      route: "00700",
      segments: [[["NRW", "DIS"], 550], [["DIS", "SMK"], 400], [["SMK", "IPS"], 400], [["IPS", "LST"], 3000]]
    });
  });

});
