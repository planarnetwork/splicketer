import { ZipFile } from "@gb-transit/fares-source";
import type { RouteingNetwork } from "@gb-transit/routeing-source";
import { ANY_PERMITTED_ROUTES } from "../fares/FareIndex.js";

/**
 * A negative easement of the routeing guide: journeys between a station at one end and a station at the other may not
 * go via the forbidden stations, in either direction.
 */
export interface NegativeEasement {
  readonly ends: readonly [Int32Array, Int32Array];
  readonly forbidden: Int32Array;
}

const NEGATIVE = "2";
const MANUAL = "6";
const APPLICABLE = "1";
const ORIGIN = "2";
const DESTINATION = "3";
const VIA = "4";
const ROUTE = "3";
const EVERY_DAY = "YYYYYYY";

/**
 * The negative easements in force on a date that apply to any permitted tickets, with stations numbered as in the
 * network. A split may not be made at a forbidden station of an easement between the origin and destination.
 *
 * Where an easement names only one end, its via locations are taken as the other, as in "journeys between London and
 * Ipswich": that is how the via locations of those easements read. Where it names both ends its via locations are
 * ignored, which applies it to more journeys than it strictly covers. Easements that only apply to other routes, to a
 * train company or to a ticket type, on some days or at some times of day, and manual easements, are left out.
 */
export async function loadNegativeEasements(zipPath: string, network: RouteingNetwork, date: string): Promise<NegativeEasement[]> {
  const zip = ZipFile.open(zipPath);
  const entry = zip.entries.find(e => e.name.toUpperCase().endsWith(".RGF"));
  const day = date.replace(/-/g, "");
  const easements = new Map<string, string[]>();
  const locations = new Map<string, [code: string, modifier: string][]>();
  const details = new Map<string, [type: string, code: string][]>();

  if (entry === undefined) {
    throw new Error(`${zipPath} has no easements (RGF)`);
  }

  await zip.eachLine(entry, line => {
    const fields = line.split(",");
    const add = <T>(map: Map<string, T[]>, value: T) => map.set(fields[1], [...(map.get(fields[1]) ?? []), value]);

    if (fields[0] === "E") {
      easements.set(fields[1], fields);
    }
    else if (fields[0] === "L") {
      add(locations, [fields[2], fields[3]] as [string, string]);
    }
    else if (fields[0] === "D") {
      add(details, [fields[2], fields[3]] as [string, string]);
    }
  });

  const stationsOf = (code: string): number[] => {
    const point = network.routeingPoint(code);
    const station = network.station(code);

    return point !== undefined && network.stationsOf(point).length > 1 ? Array.from(network.stationsOf(point))
      : station === undefined ? [] : [station];
  };
  const stations = (easementLocations: [string, string][], modifier: string) =>
    Int32Array.from(easementLocations.filter(([, m]) => m === modifier).flatMap(([code]) => stationsOf(code)));

  const result: NegativeEasement[] = [];

  for (const [reference, [, , start, end, , , easementClass, category, days, timeFrom]] of easements) {
    const easementDetails = details.get(reference) ?? [];
    const routes = easementDetails.filter(([type]) => type === ROUTE).map(([, code]) => code);
    const inForce = ddmmyyyy(start) <= day && day <= ddmmyyyy(end);
    const general = easementDetails.every(([type]) => type === ROUTE) && days === EVERY_DAY && (timeFrom === undefined || timeFrom === "");
    const anyPermitted = routes.length === 0 || routes.some(route => ANY_PERMITTED_ROUTES.includes(route));

    if (easementClass !== NEGATIVE || category === MANUAL || !inForce || !general || !anyPermitted) {
      continue;
    }

    const easementLocations = locations.get(reference) ?? [];
    const forbidden = stations(easementLocations, APPLICABLE);
    const via = stations(easementLocations, VIA);
    let from = stations(easementLocations, ORIGIN);
    let to = stations(easementLocations, DESTINATION);

    if (from.length === 0) {
      from = via;
    }
    else if (to.length === 0) {
      to = via;
    }

    if (forbidden.length > 0 && from.length > 0 && to.length > 0) {
      result.push({ends: [from, to], forbidden});
    }
  }

  return result;
}

function ddmmyyyy(date: string): string {
  return date.slice(4, 8) + date.slice(2, 4) + date.slice(0, 2);
}
