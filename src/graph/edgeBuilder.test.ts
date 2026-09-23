import type { FaresData } from "@gb-transit/fares-source";
import type { PermittedStations } from "@gb-transit/knowledgebase-fare-group-permitted-stations";
import { feed, type TestFeed } from "../../test/fixtures/fares.js";
import { describe, expect, it } from "vitest";
import { CATEGORIES } from "../fares/category.js";
import { buildFareIndex, NO_PRICE } from "../fares/fareIndex.js";
import { EdgeBuilder } from "./edgeBuilder.js";

/**
 * The fares in a category from one station to another: any permitted, the cheapest over every route, and the route
 * specific fares cheaper than the any permitted one
 */
function fares(data: FaresData, from: string, to: string, category = "ANY-S", permitted: PermittedStations[] = []) {
  const index = buildFareIndex(data, permitted);
  const anyPermitted = CATEGORIES.map(() => new Uint32Array(index.stations.length));
  const cheapest = CATEGORIES.map(() => new Uint32Array(index.stations.length));
  const c = CATEGORIES.indexOf(category as never);
  const destination = index.stations.indexOf(to);
  const edges = new EdgeBuilder(index).station(index.stations.indexOf(from), anyPermitted, cheapest)[c];
  const price = (value: number) => (value === NO_PRICE ? undefined : value);

  return {
    anyPermitted: price(anyPermitted[c][destination]),
    cheapest: price(cheapest[c][destination]),
    routes: Object.fromEntries([...edges.route].flatMap((route, e) =>
      edges.destination[e] === destination ? [[index.routes[route], edges.price[e]]] : []
    ))
  };
}

function fare(data: FaresData, from: string, to: string, category = "ANY-S", permitted: PermittedStations[] = []): number | undefined {
  return fares(data, from, to, category, permitted).cheapest;
}

function permits(fareGroup: string, fareLocation: string, stations: string[], routeCode = "00000"): PermittedStations {
  return {fareGroup, fareLocation, routeCode, startDate: "2020-01-01", endDate: "2999-12-31", stations};
}

const STATIONS: TestFeed["stations"] = [["AAA", "1111"], ["BBB", "2222"], ["CCC", "3333"]];

describe("EdgeBuilder", () => {

  it("prices a flow between two stations in each category, ignoring tickets outside them", () => {
    const data = feed({stations: STATIONS, flows: [{origin: "1111", destination: "2222", fares: {SOS: 1000, SVS: 700, SOR: 1500, TCS: 100}}]});

    expect(fare(data, "AAA", "BBB", "ANY-S")).toBe(1000);
    expect(fare(data, "AAA", "BBB", "OFP-S")).toBe(700);
    expect(fare(data, "AAA", "BBB", "ANY-R")).toBe(1500);
    expect(fare(data, "AAA", "BBB", "ADV-S")).toBeUndefined();
  });

  it("uses reversible flows in both directions and others in one", () => {
    const data = feed({stations: STATIONS, flows: [
      {origin: "1111", destination: "2222", fares: {SOS: 1000}},
      {origin: "1111", destination: "3333", reversible: false, fares: {SOS: 2000}}
    ]});

    expect(fare(data, "BBB", "AAA")).toBe(1000);
    expect(fare(data, "AAA", "CCC")).toBe(2000);
    expect(fare(data, "CCC", "AAA")).toBeUndefined();
  });

  it("prefers a flow between the two NLCs over one from a cluster, even when the cluster is cheaper", () => {
    const data = feed({stations: STATIONS, clusters: [["Q001", "1111"]], flows: [
      {origin: "1111", destination: "2222", fares: {SOS: 1000}},
      {origin: "Q001", destination: "2222", fares: {SOS: 500}}
    ]});

    expect(fare(data, "AAA", "BBB")).toBe(1000);
  });

  it("uses cluster flows for their members when there is nothing more specific", () => {
    const data = feed({stations: STATIONS, clusters: [["Q001", "1111"], ["Q002", "3333"]], flows: [
      {origin: "Q001", destination: "Q002", fares: {SOS: 800}}
    ]});

    expect(fare(data, "AAA", "CCC")).toBe(800);
  });

  it("prefers usage code A over G at the same level", () => {
    const data = feed({stations: STATIONS, flows: [
      {origin: "1111", destination: "2222", usage: "G", fares: {SOS: 500}},
      {origin: "1111", destination: "2222", usage: "A", fares: {SOS: 1000}}
    ]});

    expect(fare(data, "AAA", "BBB")).toBe(1000);
  });

  it("keeps route specific fares apart from any permitted ones, and only those that are cheaper", () => {
    const data = feed({stations: STATIONS, flows: [
      {origin: "1111", destination: "2222", fares: {SOS: 1000}},
      {origin: "1111", destination: "2222", route: "00700", fares: {SOS: 900}},
      {origin: "1111", destination: "2222", route: "00800", fares: {SOS: 1100}}
    ]});

    expect(fares(data, "AAA", "BBB")).toEqual({anyPermitted: 1000, cheapest: 900, routes: {"00700": 900}});
  });

  it("treats route 01000 as any permitted", () => {
    const data = feed({stations: STATIONS, flows: [
      {origin: "1111", destination: "2222", fares: {SOS: 1000}},
      {origin: "1111", destination: "2222", route: "01000", fares: {SOS: 900}}
    ]});

    expect(fares(data, "AAA", "BBB")).toEqual({anyPermitted: 900, cheapest: 900, routes: {}});
  });

  it("keeps route specific fares where there is no any permitted fare", () => {
    const data = feed({stations: STATIONS, flows: [{origin: "1111", destination: "2222", route: "00700", fares: {SOS: 900}}]});

    expect(fares(data, "AAA", "BBB")).toEqual({anyPermitted: undefined, cheapest: 900, routes: {"00700": 900}});
  });

  it("applies fares of a station's fare group to it", () => {
    const data = feed({stations: [["AAA", "1111", "9999"], ["BBB", "2222"]], flows: [
      {origin: "9999", destination: "2222", fares: {SOS: 1200}}
    ]});

    expect(fare(data, "AAA", "BBB")).toBe(1200);
  });

  describe("fare groups", () => {
    // AAA and CCC are both in fare group 9999, which has a fare to and from BBB
    const stations: TestFeed["stations"] = [["AAA", "1111", "9999"], ["BBB", "2222"], ["CCC", "3333", "9999"]];
    const data = feed({stations, flows: [{origin: "9999", destination: "2222", fares: {SOS: 1000}}]});

    it("lets every station of a group use its fares when nothing is listed", () => {
      expect([fare(data, "AAA", "BBB"), fare(data, "CCC", "BBB"), fare(data, "BBB", "AAA"), fare(data, "BBB", "CCC")])
        .toEqual([1000, 1000, 1000, 1000]);
    });

    it("only lets the permitted stations use a fare to or from the group", () => {
      const permitted = [permits("9999", "2222", ["AAA"])];

      expect([fare(data, "AAA", "BBB", "ANY-S", permitted), fare(data, "CCC", "BBB", "ANY-S", permitted)]).toEqual([1000, undefined]);
      expect([fare(data, "BBB", "AAA", "ANY-S", permitted), fare(data, "BBB", "CCC", "ANY-S", permitted)]).toEqual([1000, undefined]);
    });

    it("looks up the stations permitted on the fare's route", () => {
      const permitted = [permits("9999", "2222", ["AAA"], "00700")];

      expect([fare(data, "AAA", "BBB", "ANY-S", permitted), fare(data, "CCC", "BBB", "ANY-S", permitted)]).toEqual([1000, 1000]);
    });

    it("takes the most recent of two listings for the same combination", () => {
      const permitted = [permits("9999", "2222", ["AAA"]), {...permits("9999", "2222", ["CCC"]), startDate: "2024-01-01"}];

      expect([fare(data, "AAA", "BBB", "ANY-S", permitted), fare(data, "CCC", "BBB", "ANY-S", permitted)]).toEqual([undefined, 1000]);
    });
  });

  it("lets non-derivable fares replace, suppress and add fares", () => {
    const data = feed({
      stations: STATIONS,
      flows: [
        {origin: "1111", destination: "2222", fares: {SOS: 1000, SVS: 700}},
        {origin: "1111", destination: "3333", fares: {SOS: 1000}}
      ],
      nonDerivable: [
        {origin: "1111", destination: "2222", ticket: "SOS", adultFare: 800},
        {origin: "1111", destination: "2222", ticket: "SVS", adultFare: 999999},
        {origin: "2222", destination: "3333", ticket: "SOS", adultFare: 300},
        {origin: "1111", destination: "3333", ticket: "SOS", adultFare: 200, railcard: "YNG"}
      ]
    });

    expect(fare(data, "AAA", "BBB", "ANY-S")).toBe(800);
    expect(fare(data, "AAA", "BBB", "OFP-S")).toBeUndefined();
    expect(fare(data, "BBB", "CCC", "ANY-S")).toBe(300);
    expect(fare(data, "AAA", "CCC", "ANY-S")).toBe(1000);
  });

});
