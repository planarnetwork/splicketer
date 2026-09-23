import type { FareIndex } from "../fares/FareIndex.js";
import { NO_PRICE } from "../fares/FareIndex.js";
import { EdgeBuilder } from "./EdgeBuilder.js";

/**
 * The route specific fares of one category that are cheaper than the any permitted fare, grouped by route and then by
 * the station they leave from.
 *
 * Route `k` is `routes[k]`, its origin stations are `tails[tailOffsets[k]..tailOffsets[k + 1]]`, and the fares from
 * the `t`th of those are `heads` and `prices` between `edgeOffsets[t]` and `edgeOffsets[t + 1]`, cheapest first so a
 * search can stop at the first fare that is too dear. `tailIndex` finds
 * `t` from route and station, `k * stationCount + station`, or -1 where the route has no fares from the station.
 * `tailBits` and `headBits` hold, for each route, a bitset of the stations its fares leave from and go to.
 */
export interface RouteFares {
  readonly routes: Int32Array;
  readonly tailOffsets: Int32Array;
  readonly tails: Int32Array;
  readonly tailIndex: Int32Array;
  readonly edgeOffsets: Int32Array;
  readonly heads: Int32Array;
  readonly prices: Uint32Array;
  readonly tailBits: Uint32Array;
  readonly headBits: Uint32Array;
}

/**
 * No fare in a fare matrix
 */
export const NO_FARE = 0xffff;

/**
 * The fares of one category between stations, indexed from * stationCount + to with NO_FARE where there is none. Held
 * in pence as 16 bits, which halves what a search reads: the dearest fare is under £600.
 */
export interface CategoryFares {
  /** the any permitted fare */
  readonly anyPermitted: Uint16Array;
  /** the cheapest fare over every route, which is what a split has to beat */
  readonly cheapest: Uint16Array;
  readonly routeFares: RouteFares;
}

export interface SplitFares {
  /** route code of each route ID */
  readonly routes: readonly string[];
  readonly categories: CategoryFares[];
}

/**
 * The fares in each category between the given stations, backed by SharedArrayBuffers so they can be shared with
 * worker threads. Stations without fares, and fares to stations not in the list, are left out.
 */
export function buildSplitFares(index: FareIndex, stations: readonly string[], builder: EdgeBuilder = new EdgeBuilder(index)): SplitFares {
  const count = stations.length;
  const position = new Map(stations.map((crs, i) => [crs, i]));
  const toMatrix = Int32Array.from(index.stations, crs => position.get(crs) ?? -1);
  const matrix = () => new Uint16Array(new SharedArrayBuffer(count * count * 2)).fill(NO_FARE);
  const anyPermitted = Array.from({length: index.categoryCount}, matrix);
  const cheapest = Array.from({length: index.categoryCount}, matrix);
  const edges = Array.from({length: index.categoryCount}, () => new EdgeList());
  const anyPermittedRows = Array.from({length: index.categoryCount}, () => new Uint32Array(index.stations.length));
  const cheapestRows = Array.from({length: index.categoryCount}, () => new Uint32Array(index.stations.length));

  for (let station = 0; station < index.stations.length; station++) {
    const from = toMatrix[station];

    if (from === -1) {
      continue;
    }

    const routeEdges = builder.station(station, anyPermittedRows, cheapestRows);

    for (let c = 0; c < index.categoryCount; c++) {
      copyRow(anyPermittedRows[c], anyPermitted[c], from * count, toMatrix);
      copyRow(cheapestRows[c], cheapest[c], from * count, toMatrix);

      const {route, destination, price} = routeEdges[c];

      for (let e = 0; e < route.length; e++) {
        const to = toMatrix[destination[e]];

        if (to !== -1) {
          edges[c].push(route[e], from, to, price[e]);
        }
      }
    }
  }

  return {
    routes: index.routes,
    categories: anyPermitted.map((_, c) => ({
      anyPermitted: anyPermitted[c],
      cheapest: cheapest[c],
      routeFares: edges[c].group(index.routes.length, count)
    }))
  };
}

/**
 * Group route specific fares between stations by route and origin station
 */
export function buildRouteFares(edges: readonly {route: number, from: number, to: number, price: number}[], routeCount: number, stationCount: number): RouteFares {
  const list = new EdgeList();

  for (const {route, from, to, price} of edges) {
    list.push(route, from, to, price);
  }

  return list.group(routeCount, stationCount);
}

function copyRow(row: Uint32Array, matrix: Uint16Array, offset: number, toMatrix: Int32Array): void {
  for (let other = 0; other < row.length; other++) {
    const to = toMatrix[other];

    if (to !== -1 && row[other] !== NO_PRICE) {
      if (row[other] >= NO_FARE) {
        throw new Error(`A fare of ${row[other]}p is too dear to hold in a fare matrix`);
      }

      matrix[offset + to] = row[other];
    }
  }
}

class EdgeList {

  private route = new Int32Array(1 << 16);
  private from = new Int32Array(1 << 16);
  private to = new Int32Array(1 << 16);
  private price = new Uint32Array(1 << 16);
  private length = 0;

  public push(route: number, from: number, to: number, price: number): void {
    if (this.length === this.route.length) {
      this.route = grow(this.route);
      this.from = grow(this.from);
      this.to = grow(this.to);
      this.price = grow(this.price);
    }

    this.route[this.length] = route;
    this.from[this.length] = from;
    this.to[this.length] = to;
    this.price[this.length++] = price;
  }

  /**
   * Group the edges by route, then by the station they leave from, with a counting sort over (route, from)
   */
  public group(routeCount: number, stationCount: number): RouteFares {
    const words = Math.ceil(stationCount / 32);
    const keyCount = routeCount * stationCount;
    const keyOffsets = new Int32Array(keyCount + 1);

    for (let e = 0; e < this.length; e++) {
      keyOffsets[this.route[e] * stationCount + this.from[e] + 1]++;
    }
    for (let k = 0; k < keyCount; k++) {
      keyOffsets[k + 1] += keyOffsets[k];
    }

    const next = keyOffsets.slice(0, keyCount);
    const heads = shared(Int32Array, this.length);
    const prices = shared(Uint32Array, this.length);

    for (let e = 0; e < this.length; e++) {
      const position = next[this.route[e] * stationCount + this.from[e]]++;

      heads[position] = this.to[e];
      prices[position] = this.price[e];
    }

    sortByPrice(keyOffsets, heads, prices);

    const routes: number[] = [];
    const tailOffsets: number[] = [0];
    const tails: number[] = [];
    const edgeOffsets: number[] = [0];

    for (let route = 0; route < routeCount; route++) {
      const firstTail = tails.length;

      for (let from = 0; from < stationCount; from++) {
        const key = route * stationCount + from;

        if (keyOffsets[key + 1] > keyOffsets[key]) {
          tails.push(from);
          edgeOffsets.push(keyOffsets[key + 1]);
        }
      }

      if (tails.length > firstTail) {
        routes.push(route);
        tailOffsets.push(tails.length);
      }
    }

    const tailBits = shared(Uint32Array, routes.length * words);
    const headBits = shared(Uint32Array, routes.length * words);
    const tailIndex = shared(Int32Array, routes.length * stationCount).fill(-1);

    for (let k = 0; k < routes.length; k++) {
      for (let t = tailOffsets[k]; t < tailOffsets[k + 1]; t++) {
        tailIndex[k * stationCount + tails[t]] = t;
        tailBits[k * words + (tails[t] >>> 5)] |= 1 << (tails[t] & 31);

        for (let e = edgeOffsets[t]; e < edgeOffsets[t + 1]; e++) {
          headBits[k * words + (heads[e] >>> 5)] |= 1 << (heads[e] & 31);
        }
      }
    }

    return {
      routes: sharedFrom(Int32Array, routes),
      tailOffsets: sharedFrom(Int32Array, tailOffsets),
      tails: sharedFrom(Int32Array, tails),
      tailIndex,
      edgeOffsets: sharedFrom(Int32Array, edgeOffsets),
      heads,
      prices,
      tailBits,
      headBits
    };
  }

}

/**
 * Sort the fares from each station of each route cheapest first. Stations fit in 16 bits, so each fare is packed
 * with its station into one number and the numbers sorted.
 */
function sortByPrice(offsets: Int32Array, heads: Int32Array, prices: Uint32Array): void {
  const packed = new Float64Array(heads.length);

  for (let e = 0; e < heads.length; e++) {
    packed[e] = prices[e] * 65536 + heads[e];
  }
  for (let k = 0; k + 1 < offsets.length; k++) {
    if (offsets[k + 1] - offsets[k] > 1) {
      packed.subarray(offsets[k], offsets[k + 1]).sort();
    }
  }
  for (let e = 0; e < heads.length; e++) {
    prices[e] = Math.floor(packed[e] / 65536);
    heads[e] = packed[e] % 65536;
  }
}

function grow<T extends Int32Array | Uint32Array>(array: T): T {
  const grown = new (array.constructor as new (length: number) => T)(array.length * 2);
  grown.set(array);

  return grown;
}

function shared<T extends Int32Array | Uint32Array>(Type: new (buffer: SharedArrayBuffer) => T, length: number): T {
  return new Type(new SharedArrayBuffer(length * 4));
}

function sharedFrom<T extends Int32Array | Uint32Array>(Type: new (buffer: SharedArrayBuffer) => T, values: number[]): T {
  const array = shared(Type, values.length);
  array.set(values);

  return array;
}
