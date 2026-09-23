import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeZip } from "../../test/fixtures/zip.js";
import { csv, readStations, titleCase } from "./stations.js";

describe("readStations", () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "stations"));
  });

  afterEach(() => {
    fs.rmSync(directory, {recursive: true, force: true});
  });

  it("has the first stop of each CRS, named without its platform, in CRS order", async () => {
    const gtfs = writeZip(path.join(directory, "gtfs.zip"), {"stops.txt": [
      "﻿stop_id,stop_code,stop_name,stop_lat,stop_lon",
      "1,NRW,Norwich Platform 3,52.6272341,1.3068",
      "2,NRW,Norwich Platform 4,52.6,1.3",
      "3,DIS,\"Diss, Norfolk\",52.3737,1.1237",
      "4,,Bus Stop,52,1",
      "5,ABCD,Not a station,52,1",
      "6,XXX,Nowhere,0,0",
      "7,KGX,KINGS CROSS,51.5308,-0.1238"
    ].join("\r\n")});

    expect(await readStations(gtfs)).toEqual([
      ["DIS", "Diss, Norfolk", 52.3737, 1.1237],
      ["KGX", "Kings Cross", 51.5308, -0.1238],
      ["NRW", "Norwich", 52.62723, 1.3068]
    ]);
  });

  it("requires stops", async () => {
    const gtfs = writeZip(path.join(directory, "gtfs.zip"), {"routes.txt": ""});

    await expect(readStations(gtfs)).rejects.toThrow(/no stops.txt/);
  });

});

describe("csv", () => {

  it("splits a line into fields, unquoting quoted fields", () => {
    expect(csv("a,\"b, c\",\"say \"\"hi\"\"\",,d")).toEqual(["a", "b, c", "say \"hi\"", "", "d"]);
  });

});

describe("titleCase", () => {

  it("title cases names in capitals and leaves others alone", () => {
    expect(titleCase("ST IVES (CORNWALL)")).toBe("St Ives (Cornwall)");
    expect(titleCase("McKinnon's Wharf")).toBe("McKinnon's Wharf");
  });

});
