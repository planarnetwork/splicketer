import * as fs from "node:fs";
import * as path from "node:path";
import { ZipFile } from "@gb-transit/fares-source";

const TIMETABLE_FEED = /^RJTT([FC])(\d+)\.zip$/i;

/**
 * Train statuses of passenger services: P permanent, 1 short term plan
 */
const PASSENGER = new Set(["P", "1"]);

/**
 * The CRS codes of the stations a passenger train makes a public call at in the timetable feed, on a schedule that
 * runs over the date. A split point has to be somewhere a train stops.
 *
 * `source` is a timetable zip or a directory of them, in which case the most recent full refresh and the change files
 * after it are read. Deletions in change files are not applied, so a station a deleted schedule called at is kept.
 */
export async function servedStations(source: string, date: string): Promise<Set<string>> {
  const day = date.slice(2).replace(/-/g, "");
  const crsOf = new Map<string, string>();
  const served = new Set<string>();

  for (const feed of timetableFeeds(source)) {
    const zip = ZipFile.open(feed);
    const entry = zip.entries.find(e => e.name.toUpperCase().endsWith(".MCA"));

    if (entry === undefined) {
      continue;
    }

    let running = false;

    await zip.eachLine(entry, line => {
      const type = line.slice(0, 2);

      if (type === "TI") {
        const crs = line.slice(53, 56).trim();

        if (crs !== "") {
          crsOf.set(line.slice(2, 9).trim(), crs);
        }
      }
      else if (type === "BS") {
        running = line.charAt(2) !== "D" && PASSENGER.has(line.charAt(29)) && line.slice(9, 15) <= day && day <= line.slice(15, 21);
      }
      else if (running && (type === "LO" || type === "LT")) {
        if (publicTime(line.slice(15, 19))) {
          served.add(line.slice(2, 9).trim());
        }
      }
      else if (running && type === "LI") {
        if (publicTime(line.slice(25, 29)) || publicTime(line.slice(29, 33))) {
          served.add(line.slice(2, 9).trim());
        }
      }
    });
  }

  return new Set([...served].flatMap(tiploc => crsOf.has(tiploc) ? [crsOf.get(tiploc)!] : []));
}

function publicTime(time: string): boolean {
  return time.trim() !== "" && time !== "0000";
}

/**
 * The timetable feeds to read: the most recent full refresh and the change files after it
 */
function timetableFeeds(source: string): string[] {
  if (!fs.statSync(source).isDirectory()) {
    return [source];
  }

  const feeds = fs.readdirSync(source)
    .map(name => ({name, parsed: TIMETABLE_FEED.exec(name)}))
    .filter(({parsed}) => parsed !== null)
    .map(({name, parsed}) => ({path: path.join(source, name), sequence: Number(parsed![2]), refresh: parsed![1].toUpperCase() === "F"}))
    .sort((a, b) => a.sequence - b.sequence);
  const lastRefresh = feeds.findLastIndex(feed => feed.refresh);

  return feeds.slice(Math.max(lastRefresh, 0)).map(feed => feed.path);
}
