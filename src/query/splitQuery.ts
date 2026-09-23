import { leastWeightSubsequence, NoPathError, type Segment } from "least-weight-subsequence";
import { leastWeightSubsequenceAsync } from "least-weight-subsequence/async";
import { ANY_PERMITTED } from "../fares/fareIndex.js";
import type { SplitRepository } from "./splitRepository.js";

/**
 * The fare for a ticket between two stations that is valid for the route: any permitted or specific to that route.
 * Infinity if there is none.
 */
export type GetFare = (from: string, to: string, route: string) => number;
export type GetFareAsync = (from: string, to: string, route: string) => number | PromiseLike<number>;

/**
 * The cheapest way found to cover a journey with tickets of one route, and the route
 */
export interface SplitPlan {
  readonly route: string;
  readonly segments: Segment[];
}

/**
 * The calling points of a journey worth pricing a split at, by the route of the split: the first and last, and any
 * that is a split point on the cheapest split between two calling points of the journey. Any permitted splits can be
 * combined with those of any route, so their split points are included in every route's candidates.
 *
 * `callingPoints` are CRS codes in the order the journey calls at them.
 */
export function splitCandidates(repository: SplitRepository, category: string, callingPoints: readonly string[]): Map<string, string[]> {
  const last = callingPoints.length - 1;
  const position = new Map(callingPoints.map((crs, i) => [crs, i]));
  const keep = new Map<string, Uint8Array>([[ANY_PERMITTED, new Uint8Array(callingPoints.length)]]);

  for (let from = 0; from < last; from++) {
    for (let to = from + 2; to <= last; to++) {
      const split = repository.split(category, callingPoints[from], callingPoints[to]);

      if (split === undefined) {
        continue;
      }

      let marks = keep.get(split.route);

      if (marks === undefined) {
        marks = new Uint8Array(callingPoints.length);
        keep.set(split.route, marks);
      }

      for (const point of split.points) {
        const i = position.get(point);

        if (i !== undefined && i > from && i < to) {
          marks[i] = 1;
        }
      }
    }
  }

  const anyPermitted = keep.get(ANY_PERMITTED)!;
  const candidates = new Map<string, string[]>();

  for (const [route, marks] of keep) {
    candidates.set(route, callingPoints.filter((_, i) => i === 0 || i === last || marks[i] === 1 || anyPermitted[i] === 1));
  }

  return candidates;
}

/**
 * The cheapest way to cover the journey with tickets of one category, where the tickets are all any permitted or any
 * permitted and specific to one route, split only at the candidate calling points for that route. A single segment
 * means the through ticket is the cheapest, and undefined means the journey cannot be covered at all.
 */
export function planSplits(repository: SplitRepository, category: string, callingPoints: readonly string[], getFare: GetFare): SplitPlan | undefined {
  let best: SplitPlan | undefined;
  let bestTotal = Infinity;

  for (const [route, candidates] of splitCandidates(repository, category, callingPoints)) {
    const segments = coverOrUndefined(() => leastWeightSubsequence(candidates, (from, to) => getFare(from, to, route)));
    const total = segments === undefined ? Infinity : totalOf(segments);

    if (total < bestTotal) {
      best = {route, segments: segments!};
      bestTotal = total;
    }
  }

  return best;
}

/**
 * As planSplits, for fares that are looked up asynchronously. Each route's candidates are priced at the same time.
 */
export async function planSplitsAsync(repository: SplitRepository, category: string, callingPoints: readonly string[], getFare: GetFareAsync): Promise<SplitPlan | undefined> {
  const plans = await Promise.all([...splitCandidates(repository, category, callingPoints)].map(async ([route, candidates]) => {
    try {
      return {route, segments: await leastWeightSubsequenceAsync(candidates, (from, to) => getFare(from, to, route))};
    }
    catch (error) {
      if (error instanceof NoPathError) {
        return undefined;
      }

      throw error;
    }
  }));

  return plans.reduce<SplitPlan | undefined>((best, plan) =>
    plan !== undefined && (best === undefined || totalOf(plan.segments) < totalOf(best.segments)) ? plan : best,
  undefined);
}

function coverOrUndefined(cover: () => Segment[]): Segment[] | undefined {
  try {
    return cover();
  }
  catch (error) {
    if (error instanceof NoPathError) {
      return undefined;
    }

    throw error;
  }
}

function totalOf(segments: Segment[]): number {
  return segments.reduce((total, [, weight]) => total + weight, 0);
}
