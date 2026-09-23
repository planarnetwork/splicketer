import type { FaresData } from "@gb-transit/fares-source";
import type { PermittedStations } from "@gb-transit/knowledgebase-fare-group-permitted-stations";
import { ADDITIONAL_LOCATIONS, LONDON_ZONE_LOCATIONS } from "./AdditionalLocations.js";
import { CATEGORIES, categoryOf, NO_CATEGORY } from "./Category.js";

export const NO_PRICE = 0xffffffff;
export const ANY_PERMITTED = "00000";

/**
 * Routes treated as any permitted. 01000 has no description and excludes only Southsea Hoverport, which no rail
 * journey passes through, so its fares are as widely valid as those of 00000.
 */
export const ANY_PERMITTED_ROUTES: readonly string[] = [ANY_PERMITTED, "01000"];

/**
 * Everything needed to price a station to station fare, as typed arrays so it can be shared with worker threads
 * without copying.
 *
 * Locations are NLCs and station cluster IDs, numbered together. Stations are the locations with a CRS code and are
 * numbered separately, in CRS order.
 *
 * Adjacency lists are stored as offsets into a flat array: the entries of i are between offsets[i] and offsets[i + 1].
 */
export interface FareIndex {
  /** CRS code of each station */
  readonly stations: readonly string[];
  /** route code of each route ID */
  readonly routes: readonly string[];
  /** 1 for each route ID treated as any permitted */
  readonly anyPermitted: Uint8Array;
  readonly locationCount: number;
  readonly categoryCount: number;

  /** the locations whose fares apply to a station */
  readonly queryOffsets: Int32Array;
  readonly queryLocations: Int32Array;
  /** the stations a location's fares apply to, the inverse of queryLocations */
  readonly stationOffsets: Int32Array;
  readonly stationsAt: Int32Array;
  /** 1 for station cluster IDs */
  readonly isCluster: Uint8Array;
  /** the clusters an NLC is a member of */
  readonly clusterOffsets: Int32Array;
  readonly clustersOf: Int32Array;
  /** the NLCs in a cluster */
  readonly memberOffsets: Int32Array;
  readonly members: Int32Array;

  /** flows leaving a location, with reversible flows also listed from their destination */
  readonly outOffsets: Int32Array;
  readonly outFlow: Int32Array;
  readonly outDestination: Int32Array;
  readonly flowRoute: Uint16Array;
  /** 0 for usage code A, 1 for G */
  readonly flowUsage: Uint8Array;
  /** cheapest fare on each flow in each category, flow * categoryCount + category */
  readonly flowPrices: Uint32Array;
  /** every fare on each flow, for applying non-derivable fare overrides */
  readonly fareOffsets: Int32Array;
  readonly fareTicket: Uint16Array;
  readonly farePrice: Uint32Array;
  readonly ticketCategory: Int8Array;

  /**
   * Adult non-derivable fares, keyed by nfoKey(origin, destination, route) and sorted, each with the tickets it
   * overrides. A price of NO_PRICE suppresses the flow fare for that ticket.
   */
  readonly nfoKeys: Float64Array;
  readonly nfoOffsets: Int32Array;
  readonly nfoTicket: Uint16Array;
  readonly nfoPrice: Uint32Array;

  /** 1 for each location that is a fare group with permitted stations */
  readonly isFareGroup: Uint8Array;
  /**
   * The stations of a fare group a fare between it and a location may be used from or to, on a route, keyed by
   * permittedKey(group, location, route). A combination not listed permits every station of the group.
   */
  readonly permitted: ReadonlyMap<number, Int32Array>;
}

export function nfoKey(index: Pick<FareIndex, "locationCount" | "routes">, origin: number, destination: number, route: number): number {
  return (origin * index.locationCount + destination) * index.routes.length + route;
}

export function permittedKey(index: Pick<FareIndex, "locationCount" | "routes">, group: number, location: number, route: number): number {
  return (group * index.locationCount + location) * index.routes.length + route;
}

/**
 * Build the index from a fares feed that has already been filtered to one date, and the fare group permitted stations
 * in force on it
 */
export function buildFareIndex(data: FaresData, permittedStations: readonly PermittedStations[] = []): FareIndex {
  const locationIds = new Map<string, number>(data.codes.locations.values.map((code, id) => [code, id]));
  const locationId = (code: string) => {
    let id = locationIds.get(code);

    if (id === undefined) {
      id = locationIds.size;
      locationIds.set(code, id);
    }

    return id;
  };

  const stationLocations = stationsOf(data);
  const stations = stationLocations.map(s => s.crs);
  const query = stationLocations.map(s => s.query.map(locationId));

  const clusterIds = new Set(data.stationClusters.map(c => locationId(c.clusterId)));
  const clusterPairs = data.stationClusters.map(c => [locationId(c.nlc), locationId(c.clusterId)] as const);

  const routes = data.codes.routes.values.slice();

  const nfoRows = nonDerivableRows(data, locationId, routes);
  const locationCount = locationIds.size;
  const isCluster = new Uint8Array(locationCount);

  for (const id of clusterIds) {
    isCluster[id] = 1;
  }

  const queryIndex = adjacency(stations.length, query.flatMap((locations, station) => locations.map(l => [station, l] as const)));
  const stationIndex = adjacency(locationCount, query.flatMap((locations, station) => locations.map(l => [l, station] as const)));
  const clusterIndex = adjacency(locationCount, clusterPairs);
  const memberIndex = adjacency(locationCount, clusterPairs.map(([nlc, cluster]) => [cluster, nlc] as const));
  const flows = flowIndex(data, locationCount);
  const fares = fareIndex(data);

  const permitted = permittedIndex(permittedStations, locationIds, routes, stations, locationCount);

  return {
    stations,
    routes,
    anyPermitted: Uint8Array.from(routes, route => (ANY_PERMITTED_ROUTES.includes(route) ? 1 : 0)),
    locationCount,
    categoryCount: CATEGORIES.length,
    queryOffsets: queryIndex.offsets,
    queryLocations: queryIndex.values,
    stationOffsets: stationIndex.offsets,
    stationsAt: stationIndex.values,
    isCluster,
    clusterOffsets: clusterIndex.offsets,
    clustersOf: clusterIndex.values,
    memberOffsets: memberIndex.offsets,
    members: memberIndex.values,
    ...flows,
    ...fares,
    ...nonDerivableIndex(nfoRows, locationCount, routes),
    ...permitted
  };
}

/**
 * Index the fare group permitted stations by group, location and route. Where a combination is listed more than once
 * the one that started most recently is the one in force. Groups, locations and routes that no flow uses cannot
 * restrict anything, so they are left out.
 */
function permittedIndex(records: readonly PermittedStations[], locationIds: Map<string, number>, routes: string[], stations: string[], locationCount: number) {
  const stationIds = new Map(stations.map((crs, i) => [crs, i]));
  const latest = new Map<number, PermittedStations>();
  const isFareGroup = new Uint8Array(locationCount);

  for (const record of records) {
    const group = locationIds.get(record.fareGroup);
    const location = locationIds.get(record.fareLocation);
    const route = routes.indexOf(record.routeCode);

    if (group === undefined || location === undefined || route === -1 || group >= locationCount || location >= locationCount) {
      continue;
    }

    const key = permittedKey({locationCount, routes}, group, location, route);
    const current = latest.get(key);

    if (current === undefined || record.startDate > current.startDate) {
      latest.set(key, record);
    }

    isFareGroup[group] = 1;
  }

  const permitted = new Map<number, Int32Array>();

  for (const [key, record] of latest) {
    permitted.set(key, Int32Array.from(record.stations.flatMap(crs => stationIds.has(crs) ? [stationIds.get(crs)!] : [])));
  }

  return {isFareGroup, permitted};
}

interface StationLocations {
  crs: string;
  query: string[];
}

/**
 * The stations and the locations whose fares apply to each: its own NLC, its fare group, the hardcoded additions and
 * the London zonal locations for its zone. Group stations a station is a member of are reached through its fare
 * group and the additions, not by membership alone, as that is how the fares lookup process defines them.
 */
function stationsOf(data: FaresData): StationLocations[] {
  const byCrs = new Map<string, StationLocations>();

  for (const location of data.locations) {
    if (location.crs === null || location.nlc === null || byCrs.has(location.crs)) {
      continue;
    }

    const query = new Set([location.nlc]);

    if (location.fareGroup !== null && location.fareGroup !== location.nlc) {
      query.add(location.fareGroup);
    }
    for (const nlc of ADDITIONAL_LOCATIONS[location.nlc] ?? []) {
      query.add(nlc);
    }
    for (const nlc of location.zoneInd === null ? [] : LONDON_ZONE_LOCATIONS[location.zoneInd] ?? []) {
      query.add(nlc);
    }

    byCrs.set(location.crs, {crs: location.crs, query: [...query]});
  }

  return [...byCrs.values()].sort((a, b) => a.crs.localeCompare(b.crs));
}

function flowIndex(data: FaresData, locationCount: number) {
  const {flows, fares} = data;
  const categories = CATEGORIES.length;
  const ticketCategory = ticketCategories(data);
  const flowPrices = new Uint32Array(flows.length * categories).fill(NO_PRICE);
  const flowById = flowIndexById(data);

  for (let i = 0; i < fares.length; i++) {
    const flow = flowById[fares.flowId[i]];
    const category = ticketCategory[fares.ticket[i]];
    const price = fares.price[i];

    if (flow >= 0 && category !== NO_CATEGORY && isPrice(price)) {
      const slot = flow * categories + category;
      flowPrices[slot] = Math.min(flowPrices[slot], price);
    }
  }

  const out: (readonly [number, number, number])[] = [];

  for (let flow = 0; flow < flows.length; flow++) {
    out.push([flows.origin[flow], flow, flows.destination[flow]]);

    if (flows.direction[flow] === 82) {
      out.push([flows.destination[flow], flow, flows.origin[flow]]);
    }
  }

  const outIndex = adjacency(locationCount, out.map(([origin, flow]) => [origin, flow] as const));
  const outDestination = new Int32Array(outIndex.values.length);
  const next = outIndex.offsets.slice(0, locationCount);

  for (const [origin, , destination] of out) {
    outDestination[next[origin]++] = destination;
  }

  return {
    outOffsets: outIndex.offsets,
    outFlow: outIndex.values,
    outDestination,
    flowRoute: Uint16Array.from(flows.route),
    flowUsage: Uint8Array.from(flows.usage, usage => (usage === 65 ? 0 : 1)),
    flowPrices,
    ticketCategory
  };
}

function fareIndex(data: FaresData) {
  const {flows, fares} = data;
  const flowById = flowIndexById(data);
  const fareOffsets = new Int32Array(flows.length + 1);

  for (let i = 0; i < fares.length; i++) {
    const flow = flowById[fares.flowId[i]];

    if (flow >= 0) {
      fareOffsets[flow + 1]++;
    }
  }
  for (let i = 0; i < flows.length; i++) {
    fareOffsets[i + 1] += fareOffsets[i];
  }

  const next = fareOffsets.slice(0, flows.length);
  const fareTicket = new Uint16Array(fareOffsets[flows.length]);
  const farePrice = new Uint32Array(fareOffsets[flows.length]);

  for (let i = 0; i < fares.length; i++) {
    const flow = flowById[fares.flowId[i]];

    if (flow >= 0) {
      const position = next[flow]++;
      fareTicket[position] = fares.ticket[i];
      farePrice[position] = fares.price[i];
    }
  }

  return {fareOffsets, fareTicket, farePrice};
}

type NonDerivableRow = [origin: number, destination: number, route: number, ticket: number, price: number];

/**
 * The adult fares from the non-derivable fare file that apply without a railcard. A fare of 999999 in either price
 * suppresses the flow fare it matches.
 */
function nonDerivableRows(data: FaresData, locationId: (code: string) => number, routes: string[]): NonDerivableRow[] {
  const rows: NonDerivableRow[] = [];

  for (const fare of data.nonDerivableFares) {
    if (fare.railcard !== "" || fare.compositeIndicator === "N" || fare.route === null) {
      continue;
    }

    const route = routes.indexOf(fare.route);
    const suppressed = fare.suppress || fare.adultFare === 999999 || fare.childFare === 999999;

    if (route === -1 || (!suppressed && (fare.adultFare === null || !isPrice(fare.adultFare)))) {
      continue;
    }

    rows.push([
      locationId(fare.origin),
      locationId(fare.destination),
      route,
      data.codes.tickets.id(fare.ticket),
      suppressed ? NO_PRICE : fare.adultFare!
    ]);
  }

  return rows;
}

function nonDerivableIndex(rows: NonDerivableRow[], locationCount: number, routes: string[]) {
  const key = ([origin, destination, route]: NonDerivableRow) => nfoKey({locationCount, routes}, origin, destination, route);
  const sorted = rows.map(row => ({key: key(row), row})).sort((a, b) => a.key - b.key);
  const keys: number[] = [];
  const offsets: number[] = [];

  sorted.forEach(({key}, i) => {
    if (keys.length === 0 || keys[keys.length - 1] !== key) {
      keys.push(key);
      offsets.push(i);
    }
  });
  offsets.push(sorted.length);

  return {
    nfoKeys: Float64Array.from(keys),
    nfoOffsets: Int32Array.from(offsets),
    nfoTicket: Uint16Array.from(sorted, ({row}) => row[3]),
    nfoPrice: Uint32Array.from(sorted, ({row}) => row[4])
  };
}

function ticketCategories(data: FaresData): Int8Array {
  const categories = new Int8Array(data.codes.tickets.size).fill(NO_CATEGORY);
  const types = new Map(data.ticketTypes.map(t => [t.code, t]));

  for (let id = 0; id < data.codes.tickets.size; id++) {
    const type = types.get(data.codes.tickets.value(id));
    categories[id] = type === undefined ? NO_CATEGORY : categoryOf(type);
  }

  return categories;
}

function flowIndexById(data: FaresData): Int32Array {
  let max = 0;

  for (let i = 0; i < data.flows.length; i++) {
    max = Math.max(max, data.flows.flowId[i]);
  }
  for (let i = 0; i < data.fares.length; i++) {
    max = Math.max(max, data.fares.flowId[i]);
  }

  const byId = new Int32Array(max + 1).fill(-1);

  for (let i = 0; i < data.flows.length; i++) {
    byId[data.flows.flowId[i]] = i;
  }

  return byId;
}

/**
 * Prices of 99999 and 999999 mark a fare that is not for sale, as do the 999800 placeholders a few flows carry, and
 * anything under 5p is a placeholder
 */
export function isPrice(price: number): boolean {
  return price >= 5 && price !== 99999 && price < 999800;
}

/**
 * Group (key, value) pairs by key into offsets and values, keeping the order the pairs were given in
 */
export function adjacency(size: number, pairs: readonly (readonly [number, number])[]): {offsets: Int32Array, values: Int32Array} {
  const offsets = new Int32Array(size + 1);
  const values = new Int32Array(pairs.length);

  for (const [key] of pairs) {
    offsets[key + 1]++;
  }
  for (let i = 0; i < size; i++) {
    offsets[i + 1] += offsets[i];
  }

  const next = offsets.slice(0, size);

  for (const [key, value] of pairs) {
    values[next[key]++] = value;
  }

  return {offsets, values};
}
