import { type FareIndex, isPrice, NO_PRICE, permittedKey } from "../fares/fareIndex.js";
import { NO_CATEGORY } from "../fares/category.js";

/**
 * The cheapest fare in each category from one query location to each destination location, per route
 */
export interface LocationFares {
  readonly length: number;
  readonly destination: Int32Array;
  readonly route: Uint16Array;
  /** slot * categoryCount + category */
  readonly prices: Uint32Array;
}

/**
 * The route specific fares from one station in one category that are cheaper than its any permitted fare
 */
export interface RouteEdges {
  readonly route: Uint16Array;
  readonly destination: Int32Array;
  readonly price: Uint32Array;
}

const NO_RANK = 255;

/**
 * Turns the flows and non-derivable fares into the cheapest fare between each pair of stations.
 *
 * For each pair of query locations only one flow applies per route. A flow between the two NLCs takes precedence over
 * one to the destination's cluster, then one from the origin's cluster, then one between clusters; within that, usage
 * code A takes precedence over G.
 *
 * Each route code is priced separately. A route specific fare only matters where it is cheaper than the any permitted
 * fare, as anything that can use it can also use the any permitted one.
 *
 * A fare to or from a fare group, such as London Terminals, is only used for the stations of the group that the
 * Knowledgebase permits for the location at the other end and the route. Where it lists nothing for the combination,
 * every station of the group may use the fare.
 *
 * The fares from a location are the same for every station it applies to, so locations shared by several stations
 * (group stations, zones, fare groups) are worked out once and cached.
 */
export class EdgeBuilder {

  private readonly cache = new Map<number, LocationFares>();
  private readonly categories: number;

  /** fares to or from a fare group that the permitted stations did and did not cover */
  public readonly permittedCoverage = {listed: 0, unlisted: 0};

  constructor(private readonly index: FareIndex) {
    this.categories = index.categoryCount;
  }

  /**
   * The fares from the station to every other station in each category: the any permitted fare and the cheapest over
   * every route written into rows (one per category, indexed by station), and the route specific fares that are cheaper
   * than the any permitted one returned as edges.
   */
  public station(station: number, anyPermitted: Uint32Array[], cheapest: Uint32Array[]): RouteEdges[] {
    const {index, categories} = this;
    const routeSlots = new Map<number, number>();
    const routePrices: number[] = [];
    const stationCount = index.stations.length;

    for (let c = 0; c < categories; c++) {
      anyPermitted[c].fill(NO_PRICE);
    }

    for (let q = index.queryOffsets[station]; q < index.queryOffsets[station + 1]; q++) {
      const location = index.queryLocations[q];
      const fares = this.locationFares(location);

      for (let slot = 0; slot < fares.length; slot++) {
        const destination = fares.destination[slot];
        const route = fares.route[slot];
        const priceOffset = slot * categories;
        const leaving = this.permittedStations(location, destination, route);

        if (leaving !== undefined && !leaving.includes(station)) {
          continue;
        }

        const arriving = this.permittedStations(destination, location, route);

        for (let s = index.stationOffsets[destination]; s < index.stationOffsets[destination + 1]; s++) {
          const other = index.stationsAt[s];

          if (other === station || (arriving !== undefined && !arriving.includes(other))) {
            continue;
          }

          if (index.anyPermitted[route] === 1) {
            for (let c = 0; c < categories; c++) {
              anyPermitted[c][other] = Math.min(anyPermitted[c][other], fares.prices[priceOffset + c]);
            }
            continue;
          }

          const key = route * stationCount + other;
          let routeSlot = routeSlots.get(key);

          if (routeSlot === undefined) {
            routeSlot = routeSlots.size;
            routeSlots.set(key, routeSlot);
            for (let c = 0; c < categories; c++) {
              routePrices.push(NO_PRICE);
            }
          }
          for (let c = 0; c < categories; c++) {
            const position = routeSlot * categories + c;
            routePrices[position] = Math.min(routePrices[position], fares.prices[priceOffset + c]);
          }
        }
      }
    }

    for (let c = 0; c < categories; c++) {
      cheapest[c].set(anyPermitted[c]);
    }

    const edges = Array.from({length: categories}, () => ({route: [] as number[], destination: [] as number[], price: [] as number[]}));

    for (const [key, routeSlot] of routeSlots) {
      const route = Math.floor(key / stationCount);
      const other = key - route * stationCount;

      for (let c = 0; c < categories; c++) {
        const price = routePrices[routeSlot * categories + c];

        if (price < anyPermitted[c][other]) {
          edges[c].route.push(route);
          edges[c].destination.push(other);
          edges[c].price.push(price);
          cheapest[c][other] = Math.min(cheapest[c][other], price);
        }
      }
    }

    return edges.map(e => ({
      route: Uint16Array.from(e.route),
      destination: Int32Array.from(e.destination),
      price: Uint32Array.from(e.price)
    }));
  }

  /**
   * The stations of a fare group that may use a fare between it and a location on a route, or undefined if the
   * location is not a fare group or nothing is listed for the combination, so any of its stations may
   */
  private permittedStations(group: number, location: number, route: number): Int32Array | undefined {
    const index = this.index;

    if (index.isFareGroup[group] === 0) {
      return undefined;
    }

    const stations = index.permitted.get(permittedKey(index, group, location, route));

    if (stations === undefined) {
      this.permittedCoverage.unlisted++;
    }
    else {
      this.permittedCoverage.listed++;
    }

    return stations;
  }

  /**
   * The fares from a query location, cached when the location applies to more than one station
   */
  public locationFares(location: number): LocationFares {
    const cached = this.cache.get(location);

    if (cached !== undefined) {
      return cached;
    }

    const fares = this.buildLocationFares(location);
    const index = this.index;

    if (index.stationOffsets[location + 1] - index.stationOffsets[location] > 1) {
      this.cache.set(location, fares);
    }

    return fares;
  }

  private buildLocationFares(origin: number): LocationFares {
    const {index, categories} = this;
    const routeCount = index.routes.length;
    const slots = new Map<number, number>();
    const ranks: number[] = [];
    const keys: number[] = [];
    const prices: number[] = [];
    const nfo = this.nonDerivableKeys(origin);
    const chosenFlows = new Map<number, number[]>();

    const consider = (destination: number, route: number, rank: number, flow: number) => {
      if (index.stationOffsets[destination] === index.stationOffsets[destination + 1]) {
        return;
      }

      const key = destination * routeCount + route;
      let slot = slots.get(key);
      const tracked = nfo.has(key);

      if (slot === undefined) {
        slot = keys.length;
        slots.set(key, slot);
        keys.push(key);
        ranks.push(rank);
        for (let c = 0; c < categories; c++) {
          prices.push(index.flowPrices[flow * categories + c]);
        }
        if (tracked) {
          chosenFlows.set(key, [flow]);
        }
      }
      else if (rank < ranks[slot]) {
        ranks[slot] = rank;
        for (let c = 0; c < categories; c++) {
          prices[slot * categories + c] = index.flowPrices[flow * categories + c];
        }
        if (tracked) {
          chosenFlows.set(key, [flow]);
        }
      }
      else if (rank === ranks[slot]) {
        for (let c = 0; c < categories; c++) {
          const position = slot * categories + c;
          prices[position] = Math.min(prices[position], index.flowPrices[flow * categories + c]);
        }
        if (tracked) {
          chosenFlows.get(key)!.push(flow);
        }
      }
    };

    const scan = (source: number, fromCluster: boolean) => {
      for (let o = index.outOffsets[source]; o < index.outOffsets[source + 1]; o++) {
        const flow = index.outFlow[o];
        const destination = index.outDestination[o];
        const route = index.flowRoute[flow];
        const usage = index.flowUsage[flow];

        if (index.isCluster[destination] === 1) {
          const rank = ((fromCluster ? 3 : 1) + 1) * 2 + usage;

          for (let m = index.memberOffsets[destination]; m < index.memberOffsets[destination + 1]; m++) {
            consider(index.members[m], route, rank, flow);
          }
        }
        else {
          consider(destination, route, (fromCluster ? 3 : 1) * 2 + usage, flow);
        }
      }
    };

    scan(origin, false);
    for (let k = index.clusterOffsets[origin]; k < index.clusterOffsets[origin + 1]; k++) {
      scan(index.clustersOf[k], true);
    }

    for (const [key, entries] of nfo) {
      let slot = slots.get(key);

      if (slot === undefined) {
        slot = keys.length;
        slots.set(key, slot);
        keys.push(key);
        ranks.push(NO_RANK);
        for (let c = 0; c < categories; c++) {
          prices.push(NO_PRICE);
        }
      }

      const overridden = this.withOverrides(chosenFlows.get(key) ?? [], entries);

      for (let c = 0; c < categories; c++) {
        prices[slot * categories + c] = overridden[c];
      }
    }

    return this.compact(keys, prices);
  }

  /**
   * The cheapest fare in each category over the chosen flows once non-derivable fares have replaced or suppressed
   * the flow fares for their tickets
   */
  private withOverrides(flows: number[], entries: number): number[] {
    const {index, categories} = this;
    const tickets = new Map<number, number>();

    for (const flow of flows) {
      for (let f = index.fareOffsets[flow]; f < index.fareOffsets[flow + 1]; f++) {
        const price = index.farePrice[f];

        if (isPrice(price)) {
          const ticket = index.fareTicket[f];
          tickets.set(ticket, Math.min(tickets.get(ticket) ?? NO_PRICE, price));
        }
      }
    }

    for (let n = index.nfoOffsets[entries]; n < index.nfoOffsets[entries + 1]; n++) {
      if (index.nfoPrice[n] === NO_PRICE) {
        tickets.delete(index.nfoTicket[n]);
      }
      else {
        tickets.set(index.nfoTicket[n], index.nfoPrice[n]);
      }
    }

    const prices = new Array<number>(categories).fill(NO_PRICE);

    for (const [ticket, price] of tickets) {
      const category = index.ticketCategory[ticket];

      if (category !== NO_CATEGORY) {
        prices[category] = Math.min(prices[category], price);
      }
    }

    return prices;
  }

  /**
   * The non-derivable fares from a location, keyed by destination * routeCount + route, with the position of each in
   * the non-derivable index
   */
  private nonDerivableKeys(origin: number): Map<number, number> {
    const index = this.index;
    const span = index.locationCount * index.routes.length;
    const first = origin * span;
    const result = new Map<number, number>();

    for (let i = lowerBound(index.nfoKeys, first); i < index.nfoKeys.length && index.nfoKeys[i] < first + span; i++) {
      result.set(index.nfoKeys[i] - first, i);
    }

    return result;
  }

  private compact(keys: number[], prices: number[]): LocationFares {
    const {categories, index} = this;
    const routeCount = index.routes.length;
    const kept: number[] = [];

    for (let slot = 0; slot < keys.length; slot++) {
      for (let c = 0; c < categories; c++) {
        if (prices[slot * categories + c] !== NO_PRICE) {
          kept.push(slot);
          break;
        }
      }
    }

    const result = {
      length: kept.length,
      destination: new Int32Array(kept.length),
      route: new Uint16Array(kept.length),
      prices: new Uint32Array(kept.length * categories)
    };

    kept.forEach((slot, i) => {
      result.destination[i] = Math.floor(keys[slot] / routeCount);
      result.route[i] = keys[slot] % routeCount;
      for (let c = 0; c < categories; c++) {
        result.prices[i * categories + c] = prices[slot * categories + c];
      }
    });

    return result;
  }

}

function lowerBound(values: Float64Array, target: number): number {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const middle = (low + high) >>> 1;

    if (values[middle] < target) {
      low = middle + 1;
    }
    else {
      high = middle;
    }
  }

  return low;
}
