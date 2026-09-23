import { describe, expect, it } from "vitest";
import { feed } from "../../test/fixtures/fares.js";
import { CATEGORIES } from "../fares/category.js";
import { buildFareIndex } from "../fares/fareIndex.js";
import { buildRouteFares, buildSplitFares, NO_FARE } from "./fareMatrix.js";

const ANY_S = CATEGORIES.indexOf("ANY-S");

describe("buildSplitFares", () => {
  const data = feed({
    stations: [["AAA", "1111"], ["BBB", "2222"], ["CCC", "3333"]],
    flows: [
      {origin: "1111", destination: "2222", fares: {SOS: 1000}},
      {origin: "1111", destination: "2222", route: "00700", fares: {SOS: 800}},
      {origin: "2222", destination: "3333", route: "00700", fares: {SOS: 500}}
    ]
  });

  it("holds the any permitted and cheapest fares between the given stations, in their order", () => {
    const {categories} = buildSplitFares(buildFareIndex(data), ["BBB", "AAA", "XXX"]);
    const {anyPermitted, cheapest} = categories[ANY_S];

    // BBB is 0, AAA is 1, and XXX has no fares
    expect([anyPermitted[1 * 3 + 0], anyPermitted[0 * 3 + 1], cheapest[1 * 3 + 0]]).toEqual([1000, 1000, 800]);
    expect(anyPermitted[0 * 3 + 2]).toBe(NO_FARE);
  });

  it("keeps route fares cheaper than the any permitted fare, by route and origin", () => {
    const {routes, categories} = buildSplitFares(buildFareIndex(data), ["AAA", "BBB", "CCC"]);
    const {routeFares} = categories[ANY_S];
    const k = Array.from(routeFares.routes).indexOf(routes.indexOf("00700"));
    const fares = Array.from(routeFares.tails.subarray(routeFares.tailOffsets[k], routeFares.tailOffsets[k + 1]), (tail, t) => {
      const at = routeFares.tailOffsets[k] + t;
      return [tail, Array.from(routeFares.heads.subarray(routeFares.edgeOffsets[at], routeFares.edgeOffsets[at + 1])),
        Array.from(routeFares.prices.subarray(routeFares.edgeOffsets[at], routeFares.edgeOffsets[at + 1]))];
    });

    // AAA-BBB and BBB-CCC in both directions, cheapest first
    expect(fares).toEqual([[0, [1], [800]], [1, [2, 0], [500, 800]], [2, [1], [500]]]);
  });

  it("refuses a fare too dear to hold in a fare matrix", () => {
    const dear = feed({stations: [["AAA", "1111"], ["BBB", "2222"]], flows: [{origin: "1111", destination: "2222", fares: {SOS: 70000}}]});

    expect(() => buildSplitFares(buildFareIndex(dear), ["AAA", "BBB"])).toThrow(/too dear/);
  });
});

describe("buildRouteFares", () => {

  it("groups fares by route and origin, cheapest first, with each route's stations as bitsets", () => {
    const fares = buildRouteFares([
      {route: 2, from: 1, to: 3, price: 900},
      {route: 2, from: 1, to: 0, price: 300},
      {route: 0, from: 3, to: 1, price: 100}
    ], 3, 4);

    expect(Array.from(fares.routes)).toEqual([0, 2]);
    expect(Array.from(fares.tails)).toEqual([3, 1]);
    expect(Array.from(fares.heads.subarray(fares.edgeOffsets[1], fares.edgeOffsets[2]))).toEqual([0, 3]);
    expect(Array.from(fares.prices.subarray(fares.edgeOffsets[1], fares.edgeOffsets[2]))).toEqual([300, 900]);
    expect(fares.tailIndex[1 * 4 + 1]).toBe(1);
    expect(fares.tailIndex[1 * 4 + 3]).toBe(-1);
    expect(fares.tailBits[1]).toBe(1 << 1);
    expect(fares.headBits[1]).toBe((1 << 0) | (1 << 3));
  });

  it("is empty without fares", () => {
    const fares = buildRouteFares([], 3, 4);

    expect([fares.routes.length, fares.heads.length]).toEqual([0, 0]);
  });

});
