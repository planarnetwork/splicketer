import { describe, expect, it } from "vitest";
import { ADDITIONAL_LOCATIONS, LONDON_ZONE_LOCATIONS } from "./additionalLocations.js";

const NLC = /^\d{4}$/;

describe("ADDITIONAL_LOCATIONS", () => {

  it("names every location by NLC", () => {
    for (const [nlc, additions] of Object.entries(ADDITIONAL_LOCATIONS)) {
      expect(nlc).toMatch(NLC);
      expect(additions.every(addition => NLC.test(addition))).toBe(true);
    }
  });

  it("gives the Thameslink stations of London Terminals the Thameslink group too", () => {
    for (const nlc of ["0577", "1555", "5112", "5121", "5148", "5246"]) {
      expect(ADDITIONAL_LOCATIONS[nlc]).toContain("4452");
    }
  });

  it("makes the stations whose fares are valid at each other each other's additions", () => {
    for (const [a, b] of [["5164", "5007"], ["5473", "5359"]]) {
      expect(ADDITIONAL_LOCATIONS[a]).toContain(b);
      expect(ADDITIONAL_LOCATIONS[b]).toContain(a);
    }
  });

});

describe("LONDON_ZONE_LOCATIONS", () => {

  it("covers zones one to six, by NLC and without repeats", () => {
    expect(Object.keys(LONDON_ZONE_LOCATIONS).sort()).toEqual(["1", "2", "3", "4", "5", "6"]);

    for (const locations of Object.values(LONDON_ZONE_LOCATIONS)) {
      expect(locations.every(nlc => NLC.test(nlc))).toBe(true);
      expect(new Set(locations).size).toBe(locations.length);
    }
  });

  it("gives every zone the whole of London travelcard location", () => {
    for (const locations of Object.values(LONDON_ZONE_LOCATIONS)) {
      expect(locations).toContain("0786");
    }
  });

});
