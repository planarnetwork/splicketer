import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { Worker } from "node:worker_threads";
import { loadFares } from "@gb-transit/fares-source";
import { inForce, loadPermittedStations } from "@gb-transit/knowledgebase-fare-group-permitted-stations";
import { loadRouteing, RouteingNetwork } from "@gb-transit/routeing-source";
import { CATEGORIES } from "../fares/category.js";
import { buildFareIndex } from "../fares/fareIndex.js";
import { EdgeBuilder } from "../graph/edgeBuilder.js";
import { buildSplitFares } from "../graph/fareMatrix.js";
import { writeSplitFile } from "../output/splitFile.js";
import { loadNegativeEasements } from "../routeing/negativeEasements.js";
import { servedStations } from "../timetable/servedStations.js";
import { share } from "../shared.js";
import type { SplitWorkerData, SplitWorkerResult } from "./splitWorker.js";

/** Origins with the same routeing points are searched together in groups of no more than this */
const GROUP_SIZE = 8;

const usage = "Usage: build-splits <fares zip|directory> <output.br|output.gz> [--routeing=RJRGxxxx.ZIP] [--timetable=RJTT zip|directory] "
  + "[--permitted-stations=FareGroupPermittedStations.xml] [--date=YYYY-MM-DD] [--split-penalty=100] [--shard=N/M] [--with-prices]";

/**
 * Build every split journey from the feeds, or from one shard of the origins
 */
async function main(): Promise<void> {
  const {positionals, values} = parseArgs({
    allowPositionals: true,
    options: {
      routeing: {type: "string"},
      "permitted-stations": {type: "string"},
      timetable: {type: "string"},
      "split-penalty": {type: "string", default: "100"},
      shard: {type: "string", default: "1/1"},
      date: {type: "string", default: new Date().toISOString().slice(0, 10)},
      "with-prices": {type: "boolean", default: false}
    }
  });

  if (positionals.length !== 2) {
    throw new Error(usage);
  }

  const [faresSource, output] = positionals;
  const routeingSource = values.routeing ?? routeingFeedIn(faresSource);
  const permittedSource = values["permitted-stations"] ?? permittedStationsIn(faresSource);
  const timetableSource = values.timetable ?? directoryOf(faresSource);
  const splitPenalty = Number(values["split-penalty"]);
  const [shard, shards] = parseShard(values.shard);

  if (!Number.isInteger(splitPenalty) || splitPenalty < 0) {
    throw new Error(`--split-penalty must be a whole number of pence\n${usage}`);
  }

  const [fares, routeing, permitted, served] = await Promise.all([
    loadFares(faresSource, {date: values.date}),
    loadRouteing(routeingSource),
    permittedSource === undefined ? [] : loadPermittedStations(permittedSource),
    servedStations(timetableSource, values.date)
  ]);
  const permittedInForce = permitted.filter(record => inForce(record, values.date));

  log(`loaded ${fares.flows.length} flows and ${fares.fares.length} fares valid on ${values.date}, routeing guide ${path.basename(routeingSource)}`);
  log(permittedSource === undefined
    ? "no fare group permitted stations, so every station of a fare group may use its fares"
    : `loaded ${permittedInForce.length} fare group permitted stations in force from ${path.basename(permittedSource)}`);

  const network = RouteingNetwork.build(routeing);
  const negativeEasements = await loadNegativeEasements(routeingSource, network, values.date);
  const servedByStation = Uint8Array.from(network.arrays.stations, crs => (served.has(crs) ? 1 : 0));
  log(`routeing network of ${network.stationCount} stations and ${network.arrays.routeingPoints.length} routeing points, `
    + `${servedByStation.reduce((n, s) => n + s, 0)} served by passenger trains, ${negativeEasements.length} negative easements`);

  const fareIndex = buildFareIndex(fares, permittedInForce);
  const edgeBuilder = new EdgeBuilder(fareIndex);
  const splitFares = buildSplitFares(fareIndex, network.arrays.stations, edgeBuilder);
  const {listed, unlisted} = edgeBuilder.permittedCoverage;
  log(`fares between stations in ${CATEGORIES.length} categories, ${listed} of ${listed + unlisted} fare group fares restricted to permitted stations`);

  const codes = network.arrays.stations;
  const allOrigins = codes.map((_, station) => station)
    .filter(station => network.routeingPointsOf(station).length > 0)
    .sort((a, b) => codes[a].localeCompare(codes[b]));
  const origins = shardOf(allOrigins, shard, shards);
  const {blocks, count} = await searchInWorkers(groupsOf(origins, network), origins.length, {
    network: share(network.arrays),
    fares: splitFares,
    options: {withPrices: values["with-prices"], splitPenalty, served: servedByStation, negativeEasements}
  });
  log(`found ${count} split journeys from ${origins.length} origins${shards > 1 ? `, shard ${shard} of ${shards}` : ""}`);

  const sections = CATEGORIES.flatMap((category, c) => [...blocks[c].keys()].sort().map(route => ({
    category,
    route,
    blocks: origins.map(origin => blocks[c].get(route)![origin] ?? "")
  })));
  const size = sections.reduce((total, section) => total + section.blocks.reduce((n, block) => n + block.length + 1, 0), 0);
  const bytes = await writeSplitFile(output, sections, size);
  log(`wrote ${output} (${(bytes / 1e6).toFixed(1)} MB)`);
}

const started = Date.now();
const log = (message: string) => console.log(`${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s ${message}`);

/**
 * The shard given as N/M
 */
export function parseShard(text: string): [shard: number, shards: number] {
  const [shard, shards] = text.split("/").map(Number);

  if (!Number.isInteger(shard) || !Number.isInteger(shards) || shard < 1 || shard > shards) {
    throw new Error(`--shard must be N/M with N from 1 to M\n${usage}`);
  }

  return [shard, shards];
}

/**
 * A contiguous run of the origins, so shards merge by joining each section's shards in order
 */
export function shardOf<T>(origins: readonly T[], shard: number, shards: number): T[] {
  return origins.slice(Math.floor((shard - 1) * origins.length / shards), Math.floor(shard * origins.length / shards));
}

/**
 * Origins with the same routeing points, which are searched together, in groups small enough for the work to spread
 * across the workers. The largest groups come last, as the queue is taken from the end, so none is left running on its
 * own at the end.
 */
export function groupsOf(origins: number[], network: Pick<RouteingNetwork, "routeingPointsOf">): number[][] {
  const byPoints = new Map<string, number[]>();

  for (const origin of origins) {
    const key = Array.from(network.routeingPointsOf(origin)).sort((a, b) => a - b).join(",");
    const group = byPoints.get(key) ?? [];

    group.push(origin);
    byPoints.set(key, group);
  }

  const groups = [...byPoints.values()].flatMap(group =>
    Array.from({length: Math.ceil(group.length / GROUP_SIZE)}, (_, i) => group.slice(i * GROUP_SIZE, (i + 1) * GROUP_SIZE))
  );

  return groups.sort((a, b) => a.length - b.length);
}

/**
 * Run the search from every group of origins across worker threads, each taking the next group as it finishes the last
 */
async function searchInWorkers(groups: number[][], originCount: number, data: SplitWorkerData): Promise<{blocks: Map<string, string[]>[], count: number}> {
  const blocks = CATEGORIES.map(() => new Map<string, string[]>());
  let journeys = 0;
  const queue = groups.slice();
  const workers = Math.min(Number(process.env.WORKERS) || os.availableParallelism() - 2, queue.length);
  let done = 0;

  await Promise.all(Array.from({length: workers}, () => new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL("./splitWorker.ts", import.meta.url), {workerData: data});
    const next = () => {
      const group = queue.pop();

      if (group === undefined) {
        worker.terminate().then(() => resolve(), reject);
      }
      else {
        worker.postMessage(group);
      }
    };

    worker.on("message", (result: SplitWorkerResult) => {
      result.origins.forEach((origin, g) => {
        result.blocks[g].forEach((routes, c) => {
          for (const [route, block] of routes) {
            const byOrigin = blocks[c].get(route) ?? [];

            byOrigin[origin] = block;
            blocks[c].set(route, byOrigin);
          }
        });
      });
      journeys += result.count;

      const before = done;

      done += result.origins.length;
      if (Math.floor(done / 500) > Math.floor(before / 500)) {
        log(`${done} of ${originCount} origins`);
      }

      next();
    });
    worker.on("error", reject);
    next();
  })));

  return {blocks, count: journeys};
}

/**
 * The fare group permitted stations in the same directory as the fares, if there are any
 */
export function permittedStationsIn(source: string): string | undefined {
  const directory = directoryOf(source);
  const files = fs.readdirSync(directory).filter(name => /^FareGroupPermittedStations.*\.xml$/i.test(name)).sort();

  return files.length === 0 ? undefined : path.join(directory, files[files.length - 1]);
}

/**
 * The most recent routeing guide feed in the same directory as the fares
 */
export function routeingFeedIn(source: string): string {
  const directory = directoryOf(source);
  const feeds = fs.readdirSync(directory).filter(name => /^RJRG\d+\.zip$/i.test(name)).sort();

  if (feeds.length === 0) {
    throw new Error(`No routeing guide feed in ${directory}, give one with --routeing\n${usage}`);
  }

  return path.join(directory, feeds[feeds.length - 1]);
}

/**
 * The directory a feed is in, or the feed itself if it is one
 */
function directoryOf(source: string): string {
  return fs.statSync(source).isDirectory() ? source : path.dirname(source);
}

if (import.meta.filename === process.argv[1]) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
