import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { type RouteingArrays, RouteingNetwork } from "@gb-transit/routeing-source";
import type { SplitFares } from "../graph/fareMatrix.js";
import { SplitSearch, type SplitSearchOptions } from "../graph/splitSearch.js";
import { codeBlock } from "../output/splitFile.js";

export interface SplitWorkerData {
  readonly network: RouteingArrays;
  readonly fares: SplitFares;
  readonly options: SplitSearchOptions;
}

export interface SplitWorkerResult {
  readonly origins: number[];
  /** each origin's split journeys in each category by route, front coded */
  readonly blocks: Map<string, string>[][];
  readonly count: number;
}

/**
 * Search from a group of origins with the same routeing points, and front code each origin's journeys in each
 * category and route as a block ready to be written
 */
export function codeSplits(search: SplitSearch, origins: number[]): SplitWorkerResult {
  let count = 0;
  const blocks = search.splitsFromGroup(origins).map(categories => categories.map(journeys => {
    const coded = new Map<string, string>();

    for (const [route, lines] of journeys) {
      count += lines.length;
      coded.set(route, codeBlock(lines));
    }

    return coded;
  }));

  return {origins, blocks, count};
}

if (!isMainThread && parentPort !== null) {
  const {network, fares, options} = workerData as SplitWorkerData;
  const search = new SplitSearch(new RouteingNetwork(network), fares, options);
  const port = parentPort;

  port.on("message", (origins: number[]) => {
    port.postMessage(codeSplits(search, origins) satisfies SplitWorkerResult);
  });
}
