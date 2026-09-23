import { describe, expect, it } from "vitest";
import { feed } from "../../test/fixtures/fares.js";
import { network } from "../../test/fixtures/routeing.js";
import { CATEGORIES } from "../fares/category.js";
import { buildFareIndex } from "../fares/fareIndex.js";
import { buildSplitFares } from "../graph/fareMatrix.js";
import { SplitSearch } from "../graph/splitSearch.js";
import { codeSplits } from "./splitWorker.js";

describe("codeSplits", () => {
  const net = network();
  const fares = buildSplitFares(buildFareIndex(feed({
    stations: [["AAA", "1111"], ["XXX", "2222"], ["BBB", "3333"], ["YYY", "4444"]],
    flows: [
      {origin: "1111", destination: "3333", fares: {SOS: 100}},
      {origin: "1111", destination: "2222", fares: {SOS: 30}},
      {origin: "2222", destination: "3333", fares: {SOS: 30}},
      {origin: "4444", destination: "3333", fares: {SOS: 100}},
      {origin: "4444", destination: "2222", route: "00700", fares: {SOS: 30}}
    ]
  })), net.arrays.stations);
  const search = new SplitSearch(net, fares, {splitPenalty: 0});
  const ANY_S = CATEGORIES.indexOf("ANY-S");

  it("front codes each origin's journeys in each category by route, and counts them", () => {
    const result = codeSplits(search, [net.station("AAA")!, net.station("YYY")!]);

    expect(result.origins).toEqual([net.station("AAA"), net.station("YYY")]);
    expect(result.blocks[0][ANY_S]).toEqual(new Map([["00000", "0AAAXXXBBB"]]));
    expect(result.blocks[1][ANY_S]).toEqual(new Map([["00700", "0YYYXXXBBB"]]));
    expect(result.count).toBe(2);
  });

  it("has an empty map for categories without splits", () => {
    const [categories] = codeSplits(search, [net.station("AAA")!]).blocks;

    expect(categories.filter((_, c) => c !== ANY_S).every(routes => routes.size === 0)).toBe(true);
  });

});
