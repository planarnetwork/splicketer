import { parentPort, workerData } from "node:worker_threads";
import { type RouteingArrays, RouteingNetwork } from "@gb-transit/routeing-source";
import type { SplitFares } from "../graph/FareMatrix.js";
import { SplitSearch, type SplitSearchOptions } from "../graph/SplitSearch.js";
import { codeBlock } from "../output/SplitFile.js";

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

const {network, fares, options} = workerData as SplitWorkerData;
const search = new SplitSearch(new RouteingNetwork(network), fares, options);

parentPort!.on("message", (origins: number[]) => {
  let count = 0;
  const blocks = search.splitsFromGroup(origins).map(categories => categories.map(journeys => {
    const coded = new Map<string, string>();

    for (const [route, lines] of journeys) {
      count += lines.length;
      coded.set(route, codeBlock(lines));
    }

    return coded;
  }));

  parentPort!.postMessage({origins, blocks, count} satisfies SplitWorkerResult);
});
