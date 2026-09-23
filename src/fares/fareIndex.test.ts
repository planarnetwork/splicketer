import { describe, expect, it } from "vitest";
import { feed } from "../../test/fixtures/fares.js";
import { LONDON_ZONE_LOCATIONS } from "./additionalLocations.js";
import { CATEGORIES, NO_CATEGORY } from "./category.js";
import { adjacency, buildFareIndex, type FareIndex, isPrice, NO_PRICE, permittedKey } from "./fareIndex.js";

function queryLocationsOf(index: FareIndex, crs: string): string[] {
  const station = index.stations.indexOf(crs);

  return Array.from(index.queryLocations.subarray(index.queryOffsets[station], index.queryOffsets[station + 1]), id => index.locations[id]);
}

describe("buildFareIndex", () => {

  it("numbers the stations with a CRS code in CRS order", () => {
    const index = buildFareIndex(feed({stations: [["CCC", "3333"], ["AAA", "1111"], ["BBB", "2222"]], flows: []}));

    expect(index.stations).toEqual(["AAA", "BBB", "CCC"]);
  });

  it("looks up a station's fares from its own NLC, its fare group, the additions and its London zone", () => {
    const index = buildFareIndex(feed({
      stations: [["LBG", "5148", "1072", "1"], ["CBW", "5164"]],
      flows: []
    }));

    expect(queryLocationsOf(index, "LBG")).toEqual(["5148", "1072", "4452", ...LONDON_ZONE_LOCATIONS["1"]]);
    expect(queryLocationsOf(index, "CBW")).toEqual(["5164", "5007"]);
  });

  it("indexes the stations each location's fares apply to", () => {
    const index = buildFareIndex(feed({stations: [["AAA", "1111", "9999"], ["BBB", "2222", "9999"]], flows: []}));
    const group = index.locations.indexOf("9999");

    expect(Array.from(index.stationsAt.subarray(index.stationOffsets[group], index.stationOffsets[group + 1]), s => index.stations[s]))
      .toEqual(["AAA", "BBB"]);
  });

  it("keeps each flow's cheapest fare in each category, ignoring fares not for sale", () => {
    const index = buildFareIndex(feed({
      stations: [["AAA", "1111"], ["BBB", "2222"]],
      flows: [{origin: "1111", destination: "2222", fares: {SOS: 999999, SVS: 700, TCS: 100}}]
    }));
    const price = (category: string) => index.flowPrices[CATEGORIES.indexOf(category as never)];

    expect(price("ANY-S")).toBe(NO_PRICE);
    expect(price("OFP-S")).toBe(700);
  });

  it("lists a reversible flow from both ends and a one way flow from its origin", () => {
    const index = buildFareIndex(feed({
      stations: [["AAA", "1111"], ["BBB", "2222"]],
      flows: [
        {origin: "1111", destination: "2222", fares: {SOS: 100}},
        {origin: "2222", destination: "1111", reversible: false, fares: {SOS: 100}}
      ]
    }));
    const outOf = (nlc: string) => {
      const location = index.locations.indexOf(nlc);
      return index.outOffsets[location + 1] - index.outOffsets[location];
    };

    expect([outOf("1111"), outOf("2222")]).toEqual([1, 2]);
  });

  it("treats routes 00000 and 01000 as any permitted", () => {
    const index = buildFareIndex(feed({
      stations: [["AAA", "1111"], ["BBB", "2222"]],
      flows: ["00000", "01000", "00700"].map(route => ({origin: "1111", destination: "2222", route, fares: {SOS: 100}}))
    }));

    expect(index.routes.filter((_, route) => index.anyPermitted[route] === 1)).toEqual(["00000", "01000"]);
  });

  it("puts each ticket in its category", () => {
    const data = feed({stations: [], flows: [{origin: "1111", destination: "2222", fares: {SOS: 1, TCS: 1}}]});
    const index = buildFareIndex(data);

    expect(index.ticketCategory[data.codes.tickets.find("SOS")!]).toBe(CATEGORIES.indexOf("ANY-S"));
    expect(index.ticketCategory[data.codes.tickets.find("TCS")!]).toBe(NO_CATEGORY);
  });

  it("keeps the adult non-derivable fares without a railcard, with suppressions as no price", () => {
    const index = buildFareIndex(feed({
      stations: [["AAA", "1111"], ["BBB", "2222"]],
      flows: [],
      nonDerivable: [
        {origin: "1111", destination: "2222", ticket: "SOS", adultFare: 800},
        {origin: "1111", destination: "2222", ticket: "SVS", adultFare: 999999},
        {origin: "1111", destination: "2222", ticket: "SOR", adultFare: 900, railcard: "YNG"},
        {origin: "1111", destination: "2222", ticket: "SOR", adultFare: 900, compositeIndicator: "N"}
      ]
    }));

    expect(index.nfoKeys.length).toBe(1);
    expect(Array.from(index.nfoPrice)).toEqual([800, NO_PRICE]);
  });

  it("indexes the permitted stations of a fare group, taking the most recent listing", () => {
    const index = buildFareIndex(feed({
      stations: [["AAA", "1111", "9999"], ["BBB", "2222"], ["CCC", "3333", "9999"]],
      flows: [{origin: "9999", destination: "2222", fares: {SOS: 100}}]
    }), [
      {fareGroup: "9999", fareLocation: "2222", routeCode: "00000", startDate: "2020-01-01", endDate: "2999-12-31", stations: ["AAA"]},
      {fareGroup: "9999", fareLocation: "2222", routeCode: "00000", startDate: "2024-01-01", endDate: "2999-12-31", stations: ["CCC"]},
      {fareGroup: "8888", fareLocation: "2222", routeCode: "00000", startDate: "2024-01-01", endDate: "2999-12-31", stations: ["CCC"]}
    ]);
    const group = index.locations.indexOf("9999");
    const key = permittedKey(index, group, index.locations.indexOf("2222"), index.routes.indexOf("00000"));

    expect(index.isFareGroup[group]).toBe(1);
    expect(Array.from(index.permitted.get(key)!, s => index.stations[s])).toEqual(["CCC"]);
    expect(index.permitted.size).toBe(1);
  });

});

describe("isPrice", () => {

  it("takes a fare of 5p or more as a price", () => {
    expect([isPrice(5), isPrice(1000), isPrice(59890)]).toEqual([true, true, true]);
  });

  it("does not take placeholders and fares not for sale as prices", () => {
    expect([isPrice(0), isPrice(4), isPrice(99999), isPrice(999800), isPrice(999999)]).toEqual([false, false, false, false, false]);
  });

});

describe("adjacency", () => {

  it("groups values by key in the order they were given", () => {
    const {offsets, values} = adjacency(3, [[2, 10], [0, 11], [2, 12]]);

    expect(Array.from(offsets)).toEqual([0, 1, 1, 3]);
    expect(Array.from(values)).toEqual([11, 10, 12]);
  });

});
