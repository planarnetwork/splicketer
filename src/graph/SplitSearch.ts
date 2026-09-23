import type { RouteingNetwork } from "@gb-transit/routeing-source";
import { ANY_PERMITTED } from "../fares/FareIndex.js";
import type { NegativeEasement } from "../routeing/NegativeEasements.js";
import { NO_FARE, type SplitFares } from "./FareMatrix.js";

/**
 * The split journeys from one origin in one category, keyed by the route code their tickets are for
 */
export type SplitJourneys = Map<string, string[]>;

export interface SplitSearchOptions {
  /** write the total price after each journey */
  readonly withPrices?: boolean;
  /**
   * What each ticket after the first costs in the search, in pence, on top of its fare. A split has to save at least
   * this much per extra ticket, and of two splits with the same saving the one with fewer tickets is kept.
   */
  readonly splitPenalty?: number;
  /** 1 for each station of the network a passenger train calls at; every station if not given */
  readonly served?: Uint8Array;
  readonly negativeEasements?: readonly NegativeEasement[];
}

const NO_ROUTE = -1;

/**
 * A cost not yet reached. Costs are whole pence, so they are held in 32 bits; sums are worked out as numbers, so
 * adding a fare to this never wraps around.
 */
const UNREACHED = 0xffffffff;
const UNSEEN = 0;
const OPEN = 1;
const SETTLED = 2;

/**
 * Destinations that are searched together, and the stations they may not be split at
 */
interface TargetGroup {
  readonly targets: Int32Array;
  readonly forbidden: Int32Array;
}

/**
 * Finds the cheapest combination of tickets from an origin to every destination where splitting the journey beats
 * the through fare, with every split point on a route the National Routeing Guide permits between the two.
 *
 * The tickets of a split are either all any permitted, or any permitted and route specific tickets of one route.
 * They are compared with the cheapest through ticket on any route.
 *
 * A split point has to be a station a passenger train calls at, further from the origin than the one before it and,
 * unless the destination is local to the origin, nearer the destination's routeing point. It may not be a station a
 * negative easement forbids between the origin and destination.
 *
 * Which stations are permitted depends on the destination only through its routeing points, so the search runs once
 * per routeing point over a region of the network: the stations on local journeys from the origin to its routeing
 * points, on permitted routes between those and the destination's routeing point, and on local journeys from that
 * routeing point to the stations related to it. Each destination takes the cheapest result over its routeing points.
 *
 * In each region the any permitted fares are searched first. Each route with fares in the region then carries on
 * from that result, searching again only from the stations its fares make cheaper, and only where that could still
 * make a destination cheaper. A route's result is kept as changes over the any permitted one, stamped with the search
 * they belong to, so nothing is copied per route.
 *
 * Origins with the same routeing points have almost the same regions, differing only in their own local journeys.
 * They are searched together over the union of their regions, each kept to its own by a flag per station, so what
 * depends only on the region is worked out once for all of them: the cheapest cost from each station to a destination,
 * and each route's fares between stations of the region, cheapest first.
 *
 * The fares within a region are close to a complete graph, so the searches scan arrays rather than use a heap.
 */
export class SplitSearch {

  private readonly stationCount: number;
  private readonly related: Int32Array[];
  private readonly withPrices: boolean;
  private readonly penalty: number;
  private readonly served: Uint8Array;
  private readonly forbiddenBetween = new Map<number, Map<number, Int32Array>>();
  private readonly region: Uint32Array;
  private readonly shared: Uint32Array;
  private readonly regionWords: Int32Array;
  private regionWordCount = 0;
  private readonly nodes: Int32Array;
  private readonly positions: Int32Array;
  private readonly isTarget: Uint8Array;
  private readonly allowed: Uint8Array;
  private readonly fromOrigin: Float32Array;
  private readonly toDestination: Float32Array;
  private checkDestination = true;
  private originPosition = -1;
  private readonly distances: Uint32Array;
  private readonly parents: Int32Array;
  private readonly open: Int32Array;
  private readonly routeDistances: Uint32Array;
  private readonly routeParents: Int32Array;
  private readonly routeState: Uint8Array;
  private readonly stamps: Int32Array;
  private stamp = 0;

  // the cheapest cost from each position to a destination, and the positions nearest a destination first
  private readonly toTargets: Uint32Array;
  private readonly useful: Int32Array;
  private usefulCount = 0;

  // the fares of each route with fares in the region, between positions of the region
  private memoRoutes = new Int32Array(64);
  private memoRouteCount = 0;
  private memoRouteTails = new Int32Array(64);
  private memoTailOf = new Int32Array(1 << 16);
  private memoTailPositions = new Int32Array(1 << 16);
  private memoEdgeStart = new Int32Array(1 << 16);
  private memoEdgeEnd = new Int32Array(1 << 16);
  private memoHeads = new Int32Array(1 << 18);
  private memoPrices = new Uint32Array(1 << 18);

  constructor(
    private readonly network: RouteingNetwork,
    private readonly fares: SplitFares,
    options: SplitSearchOptions = {}
  ) {
    const count = network.stationCount;
    const pointCount = network.arrays.routeingPoints.length;
    const related: number[][] = Array.from({length: pointCount}, () => []);

    for (let station = 0; station < count; station++) {
      for (const point of network.routeingPointsOf(station)) {
        related[point].push(station);
      }
    }

    this.stationCount = count;
    this.related = related.map(stations => Int32Array.from(stations));
    this.withPrices = options.withPrices ?? false;
    this.penalty = options.splitPenalty ?? 0;
    this.served = options.served ?? new Uint8Array(count).fill(1);
    this.indexEasements(options.negativeEasements ?? []);
    this.region = new Uint32Array(network.words);
    this.shared = new Uint32Array(network.words);
    this.regionWords = new Int32Array(network.words);
    this.nodes = new Int32Array(count);
    this.positions = new Int32Array(count).fill(-1);
    this.isTarget = new Uint8Array(count);
    this.allowed = new Uint8Array(count);
    this.fromOrigin = new Float32Array(count);
    this.toDestination = new Float32Array(count);
    this.distances = new Uint32Array(count);
    this.parents = new Int32Array(count);
    this.open = new Int32Array(count);
    this.routeDistances = new Uint32Array(count);
    this.routeParents = new Int32Array(count);
    this.routeState = new Uint8Array(count);
    this.stamps = new Int32Array(count);
    this.toTargets = new Uint32Array(count);
    this.useful = new Int32Array(count);
  }

  /**
   * The split journeys from the origin in each category that are cheaper than the through fare, or that have no
   * through fare, by route. Each is the concatenated CRS codes of the origin, the split points and the destination,
   * followed by the total in pence when prices are included.
   */
  public splitsFrom(origin: number): SplitJourneys[] {
    return this.splitsFromGroup([origin])[0];
  }

  /**
   * The split journeys from each origin, as splitsFrom. The origins must have the same routeing points.
   */
  public splitsFromGroup(origins: readonly number[]): SplitJourneys[][] {
    const {network, fares, related, region, shared, stationCount} = this;
    const categories = fares.categories;
    const points = network.routeingPointsOf(origins[0]);
    const results = origins.map(() => categories.map(() => ({
      best: new Uint32Array(stationCount).fill(UNREACHED),
      prices: new Uint32Array(stationCount),
      paths: new Array<string | null>(stationCount).fill(null),
      routes: new Int32Array(stationCount)
    })));

    if (points.length === 0) {
      return origins.map(() => categories.map(() => new Map()));
    }

    const locals = origins.map(origin => {
      const local = new Uint32Array(network.words);

      for (const point of points) {
        network.addLocal(origin, point, local);
      }
      local[origin >>> 5] |= 1 << (origin & 31);

      return local;
    });

    for (let destination = 0; destination < related.length; destination++) {
      const targets = related[destination];

      shared.set(network.catchment(destination));
      for (const point of points) {
        orInto(shared, network.permitted(point, destination));
      }

      region.set(shared);
      for (const local of locals) {
        orInto(region, local);
      }

      const size = this.collect(region);
      const toPoint = network.arrays.routeingPointMiles.subarray(destination * stationCount, (destination + 1) * stationCount);

      for (let i = 0; i < size; i++) {
        this.toDestination[i] = toPoint[this.nodes[i]];
      }
      this.checkDestination = !points.includes(destination);

      const groups = origins.map(origin => this.targetGroups(origin, targets));

      for (let c = 0; c < categories.length; c++) {
        const maxBound = Math.max(...origins.map((origin, g) => this.bound(c, origin, targets, results[g][c].best)));

        if (maxBound === 0) {
          continue;
        }

        this.searchToTargets(c, size, targets, maxBound);
        this.gatherRouteFares(c, size, maxBound);

        for (let g = 0; g < origins.length; g++) {
          const origin = origins[g];
          const result = results[g][c];

          this.originPosition = this.positions[origin];
          for (let i = 0; i < size; i++) {
            this.fromOrigin[i] = network.arrays.miles[origin * stationCount + this.nodes[i]];
          }

          for (const group of groups[g]) {
            const bound = this.bound(c, origin, group.targets, result.best);

            if (bound === 0) {
              continue;
            }

            for (const target of group.targets) {
              this.isTarget[this.positions[target]] = 1;
            }

            this.allow(size, locals[g], origin, group.forbidden);
            this.search(c, size, group.targets, bound);
            this.record(group.targets, i => this.distances[i], i => this.parents[i], NO_ROUTE, result);
            this.searchRoutes(c, size, group.targets, bound, result);

            for (const target of group.targets) {
              this.isTarget[this.positions[target]] = 0;
            }
          }
        }
      }

      for (let i = 0; i < size; i++) {
        this.positions[this.nodes[i]] = -1;
      }
    }

    return origins.map((origin, g) => categories.map((category, c) => {
      const {best, prices, paths, routes} = results[g][c];
      const journeys: SplitJourneys = new Map();

      for (let destination = 0; destination < stationCount; destination++) {
        const path = paths[destination];
        const through = category.cheapest[origin * stationCount + destination];

        if (path !== null && (through === NO_FARE || best[destination] < through)) {
          const route = routes[destination] === NO_ROUTE ? ANY_PERMITTED : fares.routes[routes[destination]];
          const lines = journeys.get(route) ?? [];

          lines.push(this.withPrices ? `${path} ${prices[destination]}` : path);
          journeys.set(route, lines);
        }
      }

      return journeys;
    }));
  }

  /**
   * For each station, the stations at the other end of a negative easement from it and what the easement forbids
   */
  private indexEasements(easements: readonly NegativeEasement[]): void {
    const lists = new Map<number, Map<number, Set<number>>>();
    const add = (from: number, to: number, forbidden: Int32Array) => {
      const byDestination = lists.get(from) ?? new Map<number, Set<number>>();
      const stations = byDestination.get(to) ?? new Set<number>();

      for (const station of forbidden) {
        stations.add(station);
      }
      byDestination.set(to, stations);
      lists.set(from, byDestination);
    };

    for (const {ends: [from, to], forbidden} of easements) {
      for (const a of from) {
        for (const b of to) {
          add(a, b, forbidden);
          add(b, a, forbidden);
        }
      }
    }

    for (const [from, byDestination] of lists) {
      this.forbiddenBetween.set(from, new Map([...byDestination].map(([to, stations]) => [to, Int32Array.from(stations).sort()])));
    }
  }

  /**
   * The destinations of a region grouped by the stations negative easements forbid between them and the origin, so
   * each group can be searched with its own stations taken out
   */
  private targetGroups(origin: number, targets: Int32Array): TargetGroup[] {
    const byDestination = this.forbiddenBetween.get(origin);

    if (byDestination === undefined || !targets.some(target => byDestination.has(target))) {
      return [{targets, forbidden: new Int32Array(0)}];
    }

    const groups = new Map<string, {targets: number[], forbidden: Int32Array}>();

    for (const target of targets) {
      const forbidden = byDestination.get(target) ?? new Int32Array(0);
      const key = forbidden.join(",");
      const group = groups.get(key) ?? {targets: [], forbidden};

      group.targets.push(target);
      groups.set(key, group);
    }

    return [...groups.values()].map(group => ({targets: Int32Array.from(group.targets), forbidden: group.forbidden}));
  }

  /**
   * List the stations in the region, recording each one's position in the list, and the words of the bitset that
   * have any station in them
   */
  private collect(region: Uint32Array): number {
    let size = 0;

    this.regionWordCount = 0;

    for (let w = 0; w < region.length; w++) {
      let bits = region[w];

      if (bits !== 0) {
        this.regionWords[this.regionWordCount++] = w;
      }

      while (bits !== 0) {
        const low = bits & -bits;
        const station = w * 32 + 31 - Math.clz32(low);

        this.positions[station] = size;
        this.nodes[size++] = station;
        bits ^= low;
      }
    }

    return size;
  }

  /**
   * The stations an origin may split at: those in the shared part of the region or on its own local journeys, that a
   * train calls at and a negative easement does not forbid. The destinations being searched for can always be reached,
   * but are only searched on from if they could also be split at.
   */
  private allow(size: number, local: Uint32Array, origin: number, forbidden: Int32Array): void {
    const {nodes, shared, allowed, served, positions} = this;

    for (let i = 0; i < size; i++) {
      const station = nodes[i];
      const inRegion = ((shared[station >>> 5] | local[station >>> 5]) & (1 << (station & 31))) !== 0;

      allowed[i] = station !== origin && inRegion && served[station] === 1 ? 1 : 0;
    }
    for (const station of forbidden) {
      const position = positions[station];

      if (position !== -1) {
        allowed[position] = 0;
      }
    }
  }

  /**
   * The most any destination could still use: its best so far or its through fare, whichever is lower. Nothing costing
   * more than this can improve a result.
   */
  private bound(category: number, origin: number, targets: Int32Array, best: Uint32Array): number {
    const cheapest = this.fares.categories[category].cheapest;
    let bound = 0;

    for (const target of targets) {
      if (target !== origin) {
        const through = cheapest[origin * this.stationCount + target];

        bound = Math.max(bound, Math.min(best[target], through === NO_FARE ? UNREACHED : through));
      }
    }

    return bound;
  }

  /**
   * The cost of a ticket between two positions on top of its fare: nothing for the first, the split penalty after
   */
  private hopCost(from: number): number {
    return from === this.originPosition ? 0 : this.penalty;
  }

  /**
   * Whether a journey may go on from one split point to the next: further from the origin and, unless the next is a
   * destination or the destination is local to the origin, nearer the destination's routeing point
   */
  private forward(from: number, to: number): boolean {
    return this.fromOrigin[to] > this.fromOrigin[from]
      && (!this.checkDestination || this.isTarget[to] === 1 || this.toDestination[to] < this.toDestination[from]);
  }

  /**
   * The cheapest cost from each station of the region to any destination, with the cheapest fare on any route between
   * each pair. It is never more than any route could do from any origin's part of the region, so a station that cannot
   * reach a destination for less than the dearest destination costs is no use to search from. Stations that cannot
   * reach one for less than the bound are left unreached, and the rest are listed nearest the destinations first.
   */
  private searchToTargets(category: number, size: number, targets: Int32Array, bound: number): void {
    const {nodes, positions, open, toTargets, useful, stationCount} = this;
    const matrix = this.fares.categories[category].cheapest;
    let openCount = 0;
    let usefulCount = 0;

    for (let i = 0; i < size; i++) {
      toTargets[i] = UNREACHED;
      open[openCount++] = i;
    }
    for (const target of targets) {
      toTargets[positions[target]] = 0;
    }

    while (openCount > 0) {
      let next = 0;

      for (let j = 1; j < openCount; j++) {
        if (toTargets[open[j]] < toTargets[open[next]]) {
          next = j;
        }
      }

      const current = open[next];
      const nearest = toTargets[current];

      if (nearest >= bound) {
        for (let j = 0; j < openCount; j++) {
          toTargets[open[j]] = UNREACHED;
        }
        break;
      }

      open[next] = open[--openCount];
      useful[usefulCount++] = current;

      const station = nodes[current];

      for (let j = 0; j < openCount; j++) {
        const i = open[j];
        const fare = matrix[nodes[i] * stationCount + station];

        if (fare !== NO_FARE && nearest + fare < toTargets[i]) {
          toTargets[i] = nearest + fare;
        }
      }
    }

    this.usefulCount = usefulCount;
  }

  /**
   * Each route's fares between stations of the region, by the position they leave from and cheapest first. Fares of
   * the bound or more are no use to any origin, so they are left out.
   */
  private gatherRouteFares(category: number, size: number, bound: number): void {
    const {tailIndex, tailBits, headBits, edgeOffsets, heads, prices, routes} = this.fares.categories[category].routeFares;
    const {positions, region, regionWords, regionWordCount, stationCount} = this;
    const words = this.network.words;
    let routeCount = 0;
    let tailCount = 0;
    let edgeCount = 0;

    for (let k = 0; k < routes.length; k++) {
      if (!this.touches(tailBits, k * words) || !this.touches(headBits, k * words)) {
        continue;
      }

      const slot = routeCount;
      const firstTail = tailCount;

      this.memoTailOf = ensure(this.memoTailOf, (slot + 1) * size);
      this.memoTailOf.fill(-1, slot * size, (slot + 1) * size);

      for (let w = 0; w < regionWordCount; w++) {
        const word = regionWords[w];
        let bits = tailBits[k * words + word] & region[word];

        while (bits !== 0) {
          const low = bits & -bits;
          const station = word * 32 + 31 - Math.clz32(low);
          const t = tailIndex[k * stationCount + station];
          const start = edgeCount;

          bits ^= low;
          this.memoHeads = ensure(this.memoHeads, edgeCount + edgeOffsets[t + 1] - edgeOffsets[t]);
          this.memoPrices = ensure(this.memoPrices, edgeCount + edgeOffsets[t + 1] - edgeOffsets[t]);

          for (let e = edgeOffsets[t]; e < edgeOffsets[t + 1] && prices[e] < bound; e++) {
            const to = positions[heads[e]];

            if (to !== -1) {
              this.memoHeads[edgeCount] = to;
              this.memoPrices[edgeCount++] = prices[e];
            }
          }

          if (edgeCount > start) {
            this.memoEdgeStart = ensure(this.memoEdgeStart, tailCount + 1);
            this.memoEdgeEnd = ensure(this.memoEdgeEnd, tailCount + 1);
            this.memoTailPositions = ensure(this.memoTailPositions, tailCount + 1);
            this.memoEdgeStart[tailCount] = start;
            this.memoEdgeEnd[tailCount] = edgeCount;
            this.memoTailPositions[tailCount] = positions[station];
            this.memoTailOf[slot * size + positions[station]] = tailCount++;
          }
        }
      }

      if (tailCount > firstTail) {
        this.memoRoutes = ensure(this.memoRoutes, slot + 1);
        this.memoRouteTails = ensure(this.memoRouteTails, slot + 2);
        this.memoRoutes[slot] = routes[k];
        this.memoRouteTails[slot] = firstTail;
        this.memoRouteTails[slot + 1] = tailCount;
        routeCount++;
      }
    }

    this.memoRouteCount = routeCount;
  }

  private touches(bits: Uint32Array, offset: number): boolean {
    for (let w = 0; w < this.regionWordCount; w++) {
      const word = this.regionWords[w];

      if ((bits[offset + word] & this.region[word]) !== 0) {
        return true;
      }
    }

    return false;
  }

  /**
   * Dijkstra over the origin's region with the any permitted fares, keeping the unsettled stations in a compact list so
   * each step is one pass over what remains: relaxing from the station just settled while finding the nearest to
   * settle next. It stops once every destination is settled or nothing left is under the bound.
   */
  private search(category: number, size: number, targets: Int32Array, bound: number): void {
    const {nodes, distances, parents, open, isTarget, allowed, originPosition, stationCount} = this;
    const matrix = this.fares.categories[category].anyPermitted;
    let remaining = 0;
    let openCount = 0;

    for (let i = 0; i < size; i++) {
      distances[i] = UNREACHED;
      parents[i] = -1;
      if (allowed[i] === 1 || isTarget[i] === 1) {
        open[openCount++] = i;
      }
    }
    for (const target of targets) {
      if (this.positions[target] !== originPosition) {
        remaining++;
      }
    }

    let current = originPosition;
    let nearest = 0;

    distances[current] = 0;

    while (remaining > 0 && nearest < bound) {
      const row = nodes[current] * stationCount;
      const cost = current === originPosition || allowed[current] === 1 ? nearest + this.hopCost(current) : UNREACHED;
      let next = -1;
      let nextDistance = UNREACHED;

      for (let j = 0; j < openCount; j++) {
        const i = open[j];
        const fare = matrix[row + nodes[i]];

        if (fare !== NO_FARE && cost + fare < distances[i] && this.forward(current, i)) {
          distances[i] = cost + fare;
          parents[i] = current;
        }
        if (distances[i] < nextDistance) {
          nextDistance = distances[i];
          next = j;
        }
      }

      if (next === -1) {
        break;
      }

      current = open[next];
      nearest = nextDistance;
      open[next] = open[--openCount];

      if (isTarget[current] === 1) {
        remaining--;
      }
    }
  }

  /**
   * Carry on from the any permitted result with each route that has fares within the region
   */
  private searchRoutes(category: number, size: number, targets: Int32Array, bound: number, result: CategoryResult): void {
    for (let slot = 0; slot < this.memoRouteCount; slot++) {
      this.searchRoute(category, slot, size, targets, bound, result);
    }
  }

  /**
   * Dijkstra with the any permitted fares and one route's fares, from the stations the route's fares make cheaper
   * than the any permitted result. Every other station keeps its any permitted result, which the route cannot improve
   * on without passing through a station it has made cheaper.
   *
   * A route's fares from a station are cheapest first, so each scan stops at the first one that would cost the limit
   * or more. The limit is the bound, or less once every destination is cheaper than it, and a station is only searched
   * from if it could still reach a destination for less than the limit.
   */
  private searchRoute(category: number, slot: number, size: number, targets: Int32Array, bound: number, result: CategoryResult): void {
    const {nodes, distances, parents, routeDistances, routeParents, routeState, stamps, open, isTarget, allowed, toTargets, useful, usefulCount, originPosition, stationCount, memoTailOf, memoEdgeStart, memoEdgeEnd, memoHeads, memoPrices} = this;
    const {anyPermitted} = this.fares.categories[category];
    const stamp = ++this.stamp;
    let openCount = 0;
    let improvedTarget = false;

    const distance = (i: number) => (stamps[i] === stamp ? routeDistances[i] : distances[i]);
    let limit = Math.min(bound, this.targetLimit(targets, distance));

    const improve = (to: number, cost: number, from: number) => {
      if (stamps[to] !== stamp) {
        stamps[to] = stamp;
        routeState[to] = UNSEEN;
      }

      routeDistances[to] = cost;
      routeParents[to] = from;

      if (routeState[to] === UNSEEN) {
        routeState[to] = OPEN;
        open[openCount++] = to;
      }
      if (isTarget[to] === 1) {
        improvedTarget = true;
        limit = Math.min(bound, this.targetLimit(targets, distance));
      }
    };

    const relaxRoute = (from: number, reached: number) => {
      const tail = memoTailOf[slot * size + from];

      if (tail === -1) {
        return;
      }

      const cost = reached + this.hopCost(from);

      for (let e = memoEdgeStart[tail]; e < memoEdgeEnd[tail]; e++) {
        const total = cost + memoPrices[e];

        if (total >= limit) {
          break;
        }

        const to = memoHeads[e];

        if ((allowed[to] === 0 && isTarget[to] === 0) || total + toTargets[to] >= limit || !this.forward(from, to)) {
          continue;
        }

        const stamped = stamps[to] === stamp;

        if (total < (stamped ? routeDistances[to] : distances[to]) && !(stamped && routeState[to] === SETTLED)) {
          improve(to, total, from);
        }
      }
    };

    for (let t = this.memoRouteTails[slot]; t < this.memoRouteTails[slot + 1]; t++) {
      const from = this.memoTailPositions[t];

      if (from === originPosition) {
        relaxRoute(from, 0);
      }
      else if (allowed[from] === 1 && distances[from] + toTargets[from] < limit) {
        relaxRoute(from, distances[from]);
      }
    }

    while (openCount > 0) {
      let next = 0;

      for (let j = 1; j < openCount; j++) {
        if (routeDistances[open[j]] < routeDistances[open[next]]) {
          next = j;
        }
      }

      const current = open[next];
      const nearest = routeDistances[current];

      if (nearest >= limit) {
        break;
      }

      open[next] = open[--openCount];
      routeState[current] = SETTLED;

      if (allowed[current] === 0) {
        continue;
      }

      const row = nodes[current] * stationCount;
      const cost = nearest + this.penalty;
      const budget = limit - cost;

      for (let u = 0; u < usefulCount; u++) {
        const i = useful[u];

        if (toTargets[i] >= budget) {
          break;
        }
        if (allowed[i] === 0 && isTarget[i] === 0) {
          continue;
        }

        const fare = anyPermitted[row + nodes[i]];

        if (fare === NO_FARE) {
          continue;
        }

        const total = cost + fare;

        if (total + toTargets[i] >= limit || !this.forward(current, i)) {
          continue;
        }

        const stamped = stamps[i] === stamp;

        if (total < (stamped ? routeDistances[i] : distances[i]) && !(stamped && routeState[i] === SETTLED)) {
          improve(i, total, current);
        }
      }

      relaxRoute(current, nearest);
    }

    if (improvedTarget) {
      this.record(targets, distance, i => (stamps[i] === stamp ? routeParents[i] : parents[i]), this.memoRoutes[slot], result);
    }
  }

  /**
   * The dearest any destination in the region currently is: nothing costing more can make one cheaper
   */
  private targetLimit(targets: Int32Array, distance: (position: number) => number): number {
    let limit = 0;

    for (const target of targets) {
      const position = this.positions[target];

      if (position !== this.originPosition) {
        limit = Math.max(limit, distance(position));
      }
    }

    return limit;
  }

  /**
   * Keep the result for each destination if it is the cheapest so far, noting its route, whether it splits and what it
   * costs without the split penalty
   */
  private record(targets: Int32Array, distance: (position: number) => number, parent: (position: number) => number, route: number, result: CategoryResult): void {
    const {nodes, positions} = this;
    const codes = this.network.arrays.stations;

    for (const target of targets) {
      const position = positions[target];

      if (parent(position) === -1 || distance(position) >= result.best[target]) {
        continue;
      }

      result.best[target] = distance(position);
      result.routes[target] = route;

      // the origin is the only station without a parent, so this is the through ticket
      if (parent(parent(position)) === -1) {
        result.paths[target] = null;
        result.prices[target] = distance(position);
        continue;
      }

      let path = "";
      let tickets = 0;

      for (let i = position; i !== -1; i = parent(i)) {
        path = codes[nodes[i]] + path;
        tickets++;
      }

      result.paths[target] = path;
      result.prices[target] = distance(position) - (tickets - 2) * this.penalty;
    }
  }

}

interface CategoryResult {
  readonly best: Uint32Array;
  readonly prices: Uint32Array;
  readonly paths: (string | null)[];
  readonly routes: Int32Array;
}

function orInto(target: Uint32Array, source: Uint32Array): void {
  for (let w = 0; w < target.length; w++) {
    target[w] |= source[w];
  }
}

/**
 * The array, or a larger copy of it if it is shorter than the length needed
 */
function ensure<T extends Int32Array | Uint32Array>(array: T, length: number): T {
  if (array.length >= length) {
    return array;
  }

  const grown = new (array.constructor as new (length: number) => T)(Math.max(length, array.length * 2));
  grown.set(array);

  return grown;
}
