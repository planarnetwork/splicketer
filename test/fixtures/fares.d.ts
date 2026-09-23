import { type FaresData, type NonDerivableFare } from "@gb-transit/fares-source";
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
/**
 * A fares feed built by hand: stations as (CRS, NLC, fare group), flows with their fares by ticket, clusters and
 * non-derivable fares. Ticket SOS is an anytime single, SVS an off-peak single, SOR an anytime return and TCS a child
 * fare in no category.
 */
export declare function feed({ stations, clusters, flows, nonDerivable }: TestFeed): FaresData;
