import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeZip } from "../../test/fixtures/zip.js";
import { servedStations } from "./servedStations.js";

const DATE = "2026-09-22";

/**
 * A fixed width CIF record with each value at its column
 */
function record(type: string, values: Record<number, string>): string {
  const line = Array.from<string>({length: 80}).fill(" ");

  line.splice(0, 2, ...type);
  for (const [column, value] of Object.entries(values)) {
    line.splice(Number(column), value.length, ...value);
  }

  return line.join("");
}

const tiploc = (code: string, crs: string) => record("TI", {2: code.padEnd(7), 53: crs});
const schedule = (status = "P", from = "260101", to = "261231", transaction = "N") => record("BS", {2: transaction, 9: from, 15: to, 29: status});
const origin = (code: string, time = "1000") => record("LO", {2: code.padEnd(8), 15: time});
const intermediate = (code: string, arrival: string, departure: string) => record("LI", {2: code.padEnd(8), 25: arrival, 29: departure});
const terminus = (code: string, time = "1100") => record("LT", {2: code.padEnd(8), 15: time});

const TIPLOCS = [tiploc("NRCH", "NRW"), tiploc("DISS", "DIS"), tiploc("IPSWICH", "IPS"), tiploc("MANNGTR", "MNG"), tiploc("LIVST", "LST")];

describe("servedStations", () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "served-stations"));
  });

  afterEach(() => {
    fs.rmSync(directory, {recursive: true, force: true});
  });

  const timetable = (name: string, ...lines: string[]) =>
    writeZip(path.join(directory, name), {[name.replace(/zip$/i, "MCA")]: `${lines.join("\n")}\n`});

  it("has the stations passenger trains call at publicly", async () => {
    const zip = timetable("RJTTF001.ZIP", ...TIPLOCS,
      schedule(), origin("NRCH"), intermediate("DISS", "1020", "1021"), intermediate("MANNGTR", "    ", "    "),
      intermediate("IPSWICH", "0000", "1040"), terminus("LIVST"));

    expect(await servedStations(zip, DATE)).toEqual(new Set(["NRW", "DIS", "IPS", "LST"]));
  });

  it("leaves out freight, cancelled and out of date schedules", async () => {
    const zip = timetable("RJTTF001.ZIP", ...TIPLOCS,
      schedule("F"), origin("NRCH"), terminus("DISS"),
      schedule("P", "260101", "261231", "D"), origin("IPSWICH"), terminus("DISS"),
      schedule("P", "260923", "261231"), origin("MANNGTR"), terminus("DISS"),
      schedule("1", "260101", "260922"), origin("LIVST"), terminus("DISS"));

    expect(await servedStations(zip, DATE)).toEqual(new Set(["LST", "DIS"]));
  });

  it("reads the latest refresh and the change files after it from a directory", async () => {
    timetable("RJTTF001.ZIP", ...TIPLOCS, schedule(), origin("NRCH"), terminus("DISS"));
    timetable("RJTTF002.ZIP", ...TIPLOCS, schedule(), origin("IPSWICH"), terminus("DISS"));
    timetable("RJTTC003.ZIP", schedule(), origin("LIVST"), terminus("MANNGTR"));
    fs.writeFileSync(path.join(directory, "notes.txt"), "");

    expect(await servedStations(directory, DATE)).toEqual(new Set(["IPS", "DIS", "LST", "MNG"]));
  });

});
