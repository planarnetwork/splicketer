import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { groupsOf, parseShard, permittedStationsIn, routeingFeedIn, shardOf } from "./buildSplits.js";

describe("parseShard", () => {

  it("reads N/M", () => {
    expect(parseShard("3/16")).toEqual([3, 16]);
  });

  it.each(["0/4", "5/4", "1", "a/b", "1.5/4"])("refuses %s", text => {
    expect(() => parseShard(text)).toThrow(/--shard/);
  });

});

describe("shardOf", () => {

  it("splits the origins into contiguous runs that together cover them all once", () => {
    const origins = Array.from({length: 10}, (_, i) => i);
    const shards = [1, 2, 3].map(shard => shardOf(origins, shard, 3));

    expect(shards).toEqual([[0, 1, 2], [3, 4, 5], [6, 7, 8, 9]]);
  });

});

describe("groupsOf", () => {
  const routeingPoints: number[][] = [[1], [2], [1], [2, 3], [3, 2], [1], [1], [1], [1], [1], [1], [1]];
  const network = {routeingPointsOf: (station: number) => Int32Array.from(routeingPoints[station])};

  it("groups origins by their routeing points, at most eight to a group, largest last", () => {
    const groups = groupsOf(routeingPoints.map((_, i) => i), network);

    expect(groups.map(group => group.length)).toEqual([1, 1, 2, 8]);
    expect(groups).toContainEqual([1]);
    expect(groups).toContainEqual([3, 4]);
    expect(groups.flat().sort((a, b) => a - b)).toEqual(routeingPoints.map((_, i) => i));
  });

});

describe("feeds in the fares directory", () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "build-splits"));
  });

  afterEach(() => {
    fs.rmSync(directory, {recursive: true, force: true});
  });

  const touch = (...names: string[]) => {
    for (const name of names) {
      fs.writeFileSync(path.join(directory, name), "");
    }
  };

  it("finds the latest routeing guide from the directory or a fares feed in it", () => {
    touch("RJFAF001.ZIP", "RJRG0100.ZIP", "RJRG0101.ZIP", "RJRG0102.txt");

    expect(routeingFeedIn(directory)).toBe(path.join(directory, "RJRG0101.ZIP"));
    expect(routeingFeedIn(path.join(directory, "RJFAF001.ZIP"))).toBe(path.join(directory, "RJRG0101.ZIP"));
  });

  it("requires a routeing guide", () => {
    touch("RJFAF001.ZIP");

    expect(() => routeingFeedIn(directory)).toThrow(/No routeing guide/);
  });

  it("finds the latest fare group permitted stations, if there are any", () => {
    expect(permittedStationsIn(directory)).toBeUndefined();

    touch("FareGroupPermittedStations_v1.0.xml", "FareGroupPermittedStations_v1.1.xml");

    expect(permittedStationsIn(directory)).toBe(path.join(directory, "FareGroupPermittedStations_v1.1.xml"));
  });

});
