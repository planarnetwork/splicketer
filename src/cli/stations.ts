import * as fs from "node:fs";
import { ZipFile } from "@gb-transit/fares-source";

/** Stops are platforms with the station's CRS, named "Aberdeen Platform 3" */
const PLATFORM = /\s+Platform\s+\S+$/i;

/**
 * A station as the website reads it: `[crs, name, lat, lon]`
 */
export type StationRow = [crs: string, name: string, lat: number, lon: number];

/**
 * The stations of a GTFS feed: each stop with a CRS code and a position, the first stop of each, named without its
 * platform, in CRS order
 */
export async function readStations(gtfs: string): Promise<StationRow[]> {
  const zip = ZipFile.open(gtfs);
  const entry = zip.entries.find(e => e.name === "stops.txt");

  if (entry === undefined) {
    throw new Error(`${gtfs} has no stops.txt`);
  }

  let columns: string[] | undefined;
  const stations = new Map<string, StationRow>();

  await zip.eachLine(entry, line => {
    const fields = csv(line);

    if (columns === undefined) {
      columns = fields.map(field => field.replace(/^\uFEFF/, ""));
      return;
    }

    const value = (name: string) => fields[columns!.indexOf(name)] ?? "";
    const crs = value("stop_code");
    const lat = Number(value("stop_lat"));
    const lon = Number(value("stop_lon"));

    if (/^[A-Z0-9]{3}$/.test(crs) && !stations.has(crs) && Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) {
      stations.set(crs, [crs, titleCase(value("stop_name")).replace(PLATFORM, ""), round(lat), round(lon)]);
    }
  });

  return [...stations.values()].sort((a, b) => a[0].localeCompare(b[0]));
}

/**
 * Five decimal places is about a metre, which is as close as a map of stations needs
 */
function round(degrees: number): number {
  return Math.round(degrees * 1e5) / 1e5;
}

async function main(): Promise<void> {
  const [gtfs, output] = process.argv.slice(2);

  if (gtfs === undefined || output === undefined) {
    throw new Error("Usage: stations <gtfs.zip> <stations.json>");
  }

  const stations = await readStations(gtfs);

  fs.writeFileSync(output, JSON.stringify(stations));
  console.log(`wrote ${stations.length} stations to ${output}`);
}

/**
 * The fields of a CSV line, with quoted fields unquoted
 */
export function csv(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (quoted) {
      if (char === "\"" && line[i + 1] === "\"") {
        field += "\"";
        i++;
      }
      else if (char === "\"") {
        quoted = false;
      }
      else {
        field += char;
      }
    }
    else if (char === "\"") {
      quoted = true;
    }
    else if (char === ",") {
      fields.push(field);
      field = "";
    }
    else {
      field += char;
    }
  }

  fields.push(field);

  return fields;
}

/**
 * Names written in capitals, as some bus and ferry stops are, in title case. Others are left as they are.
 */
export function titleCase(name: string): string {
  return name === name.toUpperCase() ? name.toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase()) : name;
}

if (import.meta.filename === process.argv[1]) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
