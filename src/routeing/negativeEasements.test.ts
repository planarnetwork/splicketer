import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RouteingNetwork } from "@gb-transit/routeing-source";
import { network } from "../../test/fixtures/routeing.js";
import { writeZip } from "../../test/fixtures/zip.js";
import { loadNegativeEasements } from "./negativeEasements.js";

const DATE = "2026-09-22";

interface TestEasement {
  class?: string;
  category?: string;
  start?: string;
  end?: string;
  days?: string;
  timeFrom?: string;
  locations: [code: string, modifier: string][];
  details?: [type: string, code: string][];
}

describe("loadNegativeEasements", () => {
  const routeing = network();
  const stations = (...codes: string[]) => Int32Array.from(codes, code => routeing.station(code)!);
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "negative-easements"));
  });

  afterEach(() => {
    fs.rmSync(directory, {recursive: true, force: true});
  });

  const load = (...easements: TestEasement[]) => {
    const lines = easements.flatMap((easement, i) => [
      ["E", i, easement.start ?? "01012026", easement.end ?? "31122999", "", "", easement.class ?? "2", easement.category ?? "1",
        easement.days ?? "YYYYYYY", easement.timeFrom ?? ""].join(","),
      ...easement.locations.map(([code, modifier]) => ["L", i, code, modifier].join(",")),
      ...(easement.details ?? []).map(([type, code]) => ["D", i, type, code].join(","))
    ]);
    const zip = writeZip(path.join(directory, "RJRG0001.ZIP"), {"RJRG0001.RGF": `/!! comment\n${lines.join("\n")}\n`});

    return loadNegativeEasements(zip, routeing, DATE);
  };

  it("forbids the applicable locations between the origins and destinations", async () => {
    const easements = await load({locations: [["AAA", "2"], ["BBB", "3"], ["XXX", "1"]]});

    expect(easements).toEqual([{ends: [stations("AAA"), stations("BBB")], forbidden: stations("XXX")}]);
  });

  it("takes the via locations as the missing end", async () => {
    const easements = await load(
      {locations: [["AAA", "2"], ["BBB", "4"], ["XXX", "1"]]},
      {locations: [["ZZZ", "4"], ["BBB", "3"], ["XXX", "1"]]}
    );

    expect(easements).toEqual([
      {ends: [stations("AAA"), stations("BBB")], forbidden: stations("XXX")},
      {ends: [stations("ZZZ"), stations("BBB")], forbidden: stations("XXX")}
    ]);
  });

  it("expands a group to its stations", async () => {
    const london = RouteingNetwork.build({
      stations: [
        {crs: "LST", routeingPoints: [], group: "G01"},
        {crs: "KGX", routeingPoints: [], group: "G01"},
        {crs: "AAA", routeingPoints: [], group: null},
        {crs: "XXX", routeingPoints: ["G01", "AAA"], group: null}
      ],
      routeingPoints: ["G01", "AAA"],
      nodes: ["G01", "AAA"],
      stationLinks: [["LST", "XXX"], ["KGX", "XXX"], ["XXX", "AAA"]].flatMap(([from, to]) => [{from, to, miles: 5}, {from: to, to: from, miles: 5}]),
      mapLinks: [{from: "G01", to: "AAA", map: "M1"}, {from: "AAA", to: "G01", map: "M1"}],
      permittedRoutes: [{from: "G01", to: "AAA", maps: ["M1"]}, {from: "AAA", to: "G01", maps: ["M1"]}]
    });
    const zip = writeZip(path.join(directory, "RJRG0001.ZIP"), {"RJRG0001.RGF": "E,1,01012026,31122999,,,2,1,YYYYYYY,\nL,1,G01,2\nL,1,AAA,3\nL,1,XXX,1\n"});
    const [easement] = await loadNegativeEasements(zip, london, DATE);

    expect(Array.from(easement.ends[0]).sort()).toEqual([london.station("LST")!, london.station("KGX")!].sort());
  });

  it("leaves out easements that are not general negative easements for any permitted tickets", async () => {
    const locations: [string, string][] = [["AAA", "2"], ["BBB", "3"], ["XXX", "1"]];
    const easements = await load(
      {locations, class: "1"},
      {locations, category: "6"},
      {locations, end: "01012026"},
      {locations, start: "01012027"},
      {locations, days: "YYYYYNN"},
      {locations, timeFrom: "0900"},
      {locations, details: [["3", "00700"]]},
      {locations, details: [["1", "VT"]]},
      {locations, details: [["3", "01000"], ["3", "00700"]]},
      {locations: [["AAA", "2"], ["BBB", "3"]]},
      {locations: [["AAA", "2"], ["XXX", "1"]]}
    );

    expect(easements).toEqual([{ends: [stations("AAA"), stations("BBB")], forbidden: stations("XXX")}]);
  });

  it("requires easements", async () => {
    const zip = writeZip(path.join(directory, "RJRG0001.ZIP"), {"RJRG0001.RGD": ""});

    await expect(loadNegativeEasements(zip, routeing, DATE)).rejects.toThrow(/no easements/);
  });

});
