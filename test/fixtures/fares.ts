import { CodeTable, type FaresData, type NonDerivableFare, type TicketType } from "@gb-transit/fares-source";

export interface TestFlow {
  origin: string;
  destination: string;
  route?: string;
  usage?: string;
  reversible?: boolean;
  fares: Record<string, number>;
}

export interface TestFeed {
  stations: [crs: string, nlc: string, fareGroup?: string, zoneInd?: string][];
  clusters?: [cluster: string, nlc: string][];
  flows: TestFlow[];
  nonDerivable?: Partial<NonDerivableFare>[];
}

const TICKETS: Record<string, [description: string, type: string]> = {
  SOS: ["ANYTIME S", "S"],
  SVS: ["OFF-PEAK S", "S"],
  SOR: ["ANYTIME R", "R"],
  TCS: ["UNDER 16 SINGLE", "S"]
};

/**
 * A fares feed built by hand: stations as (CRS, NLC, fare group), flows with their fares by ticket, clusters and
 * non-derivable fares. Ticket SOS is an anytime single, SVS an off-peak single, SOR an anytime return and TCS a child
 * fare in no category.
 */
export function feed({stations, clusters = [], flows, nonDerivable = []}: TestFeed): FaresData {
  const codes = {locations: new CodeTable(), routes: new CodeTable(), tickets: new CodeTable(), restrictions: new CodeTable()};
  const fares = flows.flatMap((flow, id) => Object.entries(flow.fares).map(([ticket, price]) => ({id, ticket, price})));

  codes.restrictions.id("");

  const flowColumns = {
    length: flows.length,
    flowId: Int32Array.from(flows, (_, id) => id),
    origin: Uint32Array.from(flows, f => codes.locations.id(f.origin)),
    destination: Uint32Array.from(flows, f => codes.locations.id(f.destination)),
    route: Uint32Array.from(flows, f => codes.routes.id(f.route ?? "00000")),
    usage: Uint8Array.from(flows, f => (f.usage ?? "A").charCodeAt(0)),
    direction: Uint8Array.from(flows, f => (f.reversible === false ? "S" : "R").charCodeAt(0)),
    startDate: new Uint32Array(flows.length),
    endDate: new Uint32Array(flows.length)
  };

  return {
    locations: stations.map(([crs, nlc, fareGroup, zoneInd]) => ({
      uic: `70${nlc}0`, nlc, crs, description: crs, fareGroup: fareGroup ?? nlc, zoneNo: null, zoneInd: zoneInd ?? null,
      startDate: 0, endDate: 0, quoteDate: 0
    })),
    locationGroups: [],
    stationClusters: clusters.map(([clusterId, nlc]) => ({clusterId, nlc, startDate: 0, endDate: 0})),
    ticketTypes: Object.entries(TICKETS).map(([code, [description, ticketType]]): TicketType => ({
      code, description, ticketType, startDate: 0, endDate: 0, quoteDate: 0, ticketClass: 2, ticketGroup: "",
      maxPassengers: 9, minPassengers: 1, maxAdults: 9, minAdults: 0, maxChildren: 9, minChildren: 0,
      restrictedByDate: false, restrictedByTrain: false, restrictedByArea: false, validityCode: "00", discountCategory: 0
    })),
    nonDerivableFares: nonDerivable.map(fare => ({
      origin: "", destination: "", route: "00000", railcard: "", ticket: "SOS", recordType: "O", startDate: 0,
      endDate: 0, quoteDate: 0, suppress: false, adultFare: null, childFare: null, restriction: null,
      compositeIndicator: "Y", ...fare
    })),
    flows: flowColumns,
    fares: {
      length: fares.length,
      flowId: Int32Array.from(fares, f => f.id),
      ticket: Uint16Array.from(fares, f => codes.tickets.id(f.ticket)),
      price: Uint32Array.from(fares, f => f.price),
      restriction: new Uint16Array(fares.length)
    },
    codes
  };
}
