import type { TicketType } from "@gb-transit/fares-source";

/**
 * The fare types split tickets are found within. A split only ever combines fares of the same category, so an
 * off-peak journey is never priced with an anytime ticket for one leg.
 */
export const CATEGORIES = ["ADV-S", "OFP-S", "OFP-R", "ANY-S", "ANY-R"] as const;

export type Category = (typeof CATEGORIES)[number];

export type CategoryIndex = number;

export const NO_CATEGORY = -1;

const ADVANCE = /^ADVANCE/;
const ANYTIME = /^ANYTIME/;
const OFF_PEAK = /^(OFF[- ]?P(EA)?K|SUPER OFF|SUP OFF)/;
/** Travelcards include the Underground and group tickets are priced for several people */
const EXCLUDED = /GROUP|TC$|TCD/;

/**
 * The category of a ticket type, or NO_CATEGORY for anything that is not a standard class adult walk-up or advance
 * ticket.
 *
 * The category comes from the product name rather than the restriction code or validity code. Both of those are
 * shared with products that are not tickets for a single adult: an under 16 single, a PAYG information fare and a
 * concession are all restricted, and group tickets share the advance validity codes.
 */
export function categoryOf(ticket: TicketType): CategoryIndex {
  if (ticket.ticketClass !== 2 || ticket.minPassengers > 1 || ticket.minAdults > 1) {
    return NO_CATEGORY;
  }

  const description = ticket.description.toUpperCase();

  if (EXCLUDED.test(description)) {
    return NO_CATEGORY;
  }
  if (ADVANCE.test(description)) {
    return ticket.ticketType === "S" ? CATEGORIES.indexOf("ADV-S") : NO_CATEGORY;
  }
  if (ticket.ticketType !== "S" && ticket.ticketType !== "R") {
    return NO_CATEGORY;
  }
  if (ANYTIME.test(description)) {
    return CATEGORIES.indexOf(`ANY-${ticket.ticketType}`);
  }
  if (OFF_PEAK.test(description)) {
    return CATEGORIES.indexOf(`OFP-${ticket.ticketType}`);
  }

  return NO_CATEGORY;
}
