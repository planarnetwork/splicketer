import type { TicketType } from "@gb-transit/fares-source";
import { describe, expect, it } from "vitest";
import { CATEGORIES, categoryOf, NO_CATEGORY } from "./Category.js";

function ticket(description: string, ticketType = "S", overrides: Partial<TicketType> = {}): TicketType {
  return {
    code: "XXX", description, startDate: 0, endDate: 0, quoteDate: 0, ticketClass: 2, ticketType, ticketGroup: "",
    maxPassengers: 9, minPassengers: 1, maxAdults: 9, minAdults: 0, maxChildren: 9, minChildren: 0,
    restrictedByDate: false, restrictedByTrain: false, restrictedByArea: false, validityCode: "00", discountCategory: 0,
    ...overrides
  };
}

const category = (type: TicketType) => {
  const index = categoryOf(type);

  return index === NO_CATEGORY ? undefined : CATEGORIES[index];
};

describe("categoryOf", () => {

  it("classifies the mainstream products by name", () => {
    expect(category(ticket("ANYTIME DAY S"))).toBe("ANY-S");
    expect(category(ticket("ANYTIME R", "R"))).toBe("ANY-R");
    expect(category(ticket("OFF-PEAK S"))).toBe("OFP-S");
    expect(category(ticket("SUPER OFFPEAK R", "R"))).toBe("OFP-R");
    expect(category(ticket("SUP OFFPK DAY S"))).toBe("OFP-S");
    expect(category(ticket("OFF PEAK DY SGL"))).toBe("OFP-S");
    expect(category(ticket("ADVANCE"))).toBe("ADV-S");
  });

  it("leaves out tickets that are not for one standard class adult", () => {
    expect(category(ticket("UNDER 16 SINGLE"))).toBeUndefined();
    expect(category(ticket("PAYG PEAK INFO"))).toBeUndefined();
    expect(category(ticket("ANYTIME S", "S", {ticketClass: 1}))).toBeUndefined();
    expect(category(ticket("ANYTIME S", "S", {minAdults: 3}))).toBeUndefined();
    expect(category(ticket("OFFPEAK GROUP10", "R"))).toBeUndefined();
    expect(category(ticket("ANYTIME DAY TC", "R"))).toBeUndefined();
  });

  it("leaves out seasons and advance returns", () => {
    expect(category(ticket("ANYTIME S", "N"))).toBeUndefined();
    expect(category(ticket("ADVANCE", "R"))).toBeUndefined();
  });

});
