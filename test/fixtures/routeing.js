import { RouteingNetwork } from "@gb-transit/routeing-source";
/**
 * AAA to BBB on map M1 via XXX, which is not a routeing point. ZZZ is a routeing point twenty miles off to the side,
 * and YYY is a mile behind AAA, on the far side from BBB.
 */
export function network() {
    const links = [["AAA", "XXX", 5], ["XXX", "BBB", 5], ["AAA", "ZZZ", 20], ["YYY", "AAA", 1]];
    const data = {
        stations: [
            { crs: "AAA", routeingPoints: [], group: null },
            { crs: "BBB", routeingPoints: [], group: null },
            { crs: "ZZZ", routeingPoints: [], group: null },
            { crs: "XXX", routeingPoints: ["AAA", "BBB"], group: null },
            { crs: "YYY", routeingPoints: ["AAA"], group: null }
        ],
        routeingPoints: ["AAA", "BBB", "ZZZ"],
        nodes: ["AAA", "BBB", "ZZZ"],
        stationLinks: links.flatMap(([from, to, miles]) => [{ from, to, miles }, { from: to, to: from, miles }]),
        mapLinks: [["AAA", "BBB", "M1"], ["AAA", "ZZZ", "M2"]].flatMap(([from, to, map]) => [{ from, to, map }, { from: to, to: from, map }]),
        permittedRoutes: [
            { from: "AAA", to: "BBB", maps: ["M1"] },
            { from: "BBB", to: "AAA", maps: ["M1"] },
            { from: "AAA", to: "ZZZ", maps: ["M2"] },
            { from: "ZZZ", to: "AAA", maps: ["M2"] },
            { from: "BBB", to: "ZZZ", maps: ["M1", "M2"] },
            { from: "ZZZ", to: "BBB", maps: ["M2", "M1"] }
        ]
    };
    return RouteingNetwork.build(data);
}
