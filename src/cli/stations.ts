import * as fs from "node:fs";
import { ZipFile } from "@gb-transit/fares-source";

/**
 * Write the stations of a GTFS feed as JSON for the website: `[crs, name, lat, lon]` for each stop with a CRS code,
 * the first stop of each, in CRS order.
 */
const [gtfs, output] = process.argv.slice(2);

if (gtfs === undefined || output === undefined) {
  console.error("Usage: stations <gtfs.zip> <stations.json>");
  process.exit(1);
}

const zip = ZipFile.open(gtfs);
const entry = zip.entries.find(e => e.name === "stops.txt");

if (entry === undefined) {
  console.error(`${gtfs} has no stops.txt`);
  process.exit(1);
}

/** Stops are platforms with the station's CRS, named "Aberdeen Platform 3" */
const PLATFORM = /\s+Platform\s+\S+$/i;

let columns: string[] | undefined;
const stations = new Map<string, [string, string, number, number]>();

await zip.eachLine(entry, line => {
  const fields = csv(line);

  if (columns === undefined) {
    columns = fields.map(field => field.replace(/^﻿/, ""));
    return;
  }

  const value = (name: string) => fields[columns!.indexOf(name)] ?? "";
  const crs = value("stop_code");
  const lat = Number(value("stop_lat"));
  const lon = Number(value("stop_lon"));

  if (/^[A-Z0-9]{3}$/.test(crs) && !stations.has(crs) && Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) {
    stations.set(crs, [crs, titleCase(value("stop_name")).replace(PLATFORM, ""), Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5]);
  }
});

const sorted = [...stations.values()].sort((a, b) => a[0].localeCompare(b[0]));

fs.writeFileSync(output, JSON.stringify(sorted));
console.log(`wrote ${sorted.length} stations to ${output}`);

/**
 * The fields of a CSV line, with quoted fields unquoted
 */
function csv(line: string): string[] {
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
function titleCase(name: string): string {
  return name === name.toUpperCase() ? name.toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase()) : name;
}
