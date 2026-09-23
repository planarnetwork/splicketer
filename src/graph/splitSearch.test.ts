import type { RouteingNetwork } from "@gb-transit/routeing-source";
import { describe, expect, it } from "vitest";
import { buildRouteFares, NO_FARE, type SplitFares } from "./fareMatrix.js";
import { SplitSearch, type SplitSearchOptions } from "./splitSearch.js";
import { network } from "../../test/fixtures/routeing.js";

const ROUTES = ["00000", "00700", "00800"];

/**
 * One category of fares between the network's stations. Pairs are written as "AAABBB", any permitted unless a route
 * is given as "AAABBB:00700".
 */
function category(net: RouteingNetwork, prices: Record<string, number>): SplitFares["categories"][number] {
  const count = net.stationCount;
  const anyPermitted = new Uint16Array(count * count).fill(NO_FARE);
  const cheapest = new Uint16Array(count * count).fill(NO_FARE);
  const edges: {route: number, from: number, to: number, price: number}[] = [];

  for (const [key, price] of Object.entries(prices)) {
    const [pair, route = "00000"] = key.split(":");
    const from = net.station(pair.slice(0, 3))!;
    const to = net.station(pair.slice(3))!;
    const position = from * count + to;

    if (route === "00000") {
      anyPermitted[position] = price;
    }
    else {
      edges.push({route: ROUTES.indexOf(route), from, to, price});
    }

    cheapest[position] = Math.min(cheapest[position], price);
  }

  return {anyPermitted, cheapest, routeFares: buildRouteFares(edges, ROUTES.length, count)};
}

function splits(net: RouteingNetwork, categories: Record<string, number>[], options: SplitSearchOptions | boolean = {}) {
  const fares: SplitFares = {routes: ROUTES, categories: categories.map(prices => category(net, prices))};
  const searchOptions = typeof options === "boolean" ? {withPrices: options} : options;

  return new SplitSearch(net, fares, searchOptions).splitsFrom(net.station("AAA")!).map(journeys => Object.fromEntries(journeys));
}

describe("SplitSearch", () => {

  it("splits at a station on a permitted route when it is cheaper than the through fare", () => {
    expect(splits(network(), [{AAABBB: 100, AAAXXX: 30, XXXBBB: 30}], true)).toEqual([{"00000": ["AAAXXXBBB 60"]}]);
  });

  it("does not split at a station off the permitted route, however cheap", () => {
    expect(splits(network(), [{AAABBB: 100, AAAZZZ: 10, ZZZBBB: 10}])).toEqual([{}]);
  });

  it("leaves out journeys where the through fare is cheapest", () => {
    expect(splits(network(), [{AAABBB: 50, AAAXXX: 30, XXXBBB: 30}])).toEqual([{}]);
  });

  it("compares a split with the cheapest through fare on any route", () => {
    expect(splits(network(), [{AAABBB: 100, "AAABBB:00700": 50, AAAXXX: 30, XXXBBB: 30}])).toEqual([{}]);
  });

  it("includes journeys with no through fare that can be made by splitting", () => {
    expect(splits(network(), [{AAAXXX: 30, XXXBBB: 30}])).toEqual([{"00000": ["AAAXXXBBB"]}]);
  });

  it("combines any permitted fares with those of one route", () => {
    expect(splits(network(), [{AAABBB: 100, "AAAXXX:00700": 30, XXXBBB: 30}], true)).toEqual([{"00700": ["AAAXXXBBB 60"]}]);
  });

  it("does not combine fares of two different routes", () => {
    expect(splits(network(), [{AAABBB: 100, "AAAXXX:00700": 30, "XXXBBB:00800": 30}])).toEqual([{}]);
  });

  it("only keeps a split that saves more than the penalty for each extra ticket, and writes its price without it", () => {
    const net = network();

    expect(splits(net, [{AAABBB: 100, AAAXXX: 30, XXXBBB: 30}], {splitPenalty: 50, withPrices: true})).toEqual([{}]);
    expect(splits(net, [{AAABBB: 100, AAAXXX: 30, XXXBBB: 30}], {splitPenalty: 30, withPrices: true})).toEqual([{"00000": ["AAAXXXBBB 60"]}]);
  });

  it("only splits at stations a train calls at", () => {
    const net = network();
    const served = new Uint8Array(net.stationCount).fill(1);

    served[net.station("XXX")!] = 0;

    expect(splits(net, [{AAABBB: 100, AAAXXX: 30, XXXBBB: 30}], {served})).toEqual([{}]);
  });

  it("does not split at a station behind the origin", () => {
    expect(splits(network(), [{AAABBB: 100, AAAYYY: 10, YYYBBB: 10}])).toEqual([{}]);
  });

  it("does not split at a station a negative easement forbids between the origin and destination", () => {
    const net = network();
    const negativeEasements = [{
      ends: [Int32Array.of(net.station("AAA")!), Int32Array.of(net.station("BBB")!)] as const,
      forbidden: Int32Array.of(net.station("XXX")!)
    }];

    expect(splits(net, [{AAABBB: 100, AAAXXX: 30, XXXBBB: 30}], {negativeEasements})).toEqual([{}]);
    expect(splits(net, [{AAABBB: 100, AAAXXX: 30, XXXBBB: 30}])).toEqual([{"00000": ["AAAXXXBBB"]}]);
  });

  it("searches each category separately", () => {
    expect(splits(network(), [
      {AAABBB: 100, AAAXXX: 80, XXXBBB: 80},
      {AAABBB: 100, AAAXXX: 30, XXXBBB: 30}
    ])).toEqual([{}, {"00000": ["AAAXXXBBB"]}]);
  });

});
