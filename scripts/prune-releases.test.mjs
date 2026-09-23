import { describe, expect, it } from "vitest";
import { partition } from "./prune-releases.mjs";

const everyDay = (from, days) => Array.from({length: days}, (_, i) =>
  `splits-${new Date(new Date(`${from}T00:00:00Z`).getTime() + i * 86400000).toISOString().slice(0, 10)}`
);

describe("partition", () => {

  it("keeps the most recent 30 and the earliest of each month", () => {
    const {keep, remove} = partition(everyDay("2026-06-01", 120));

    expect(keep.slice(0, 30)).toEqual(everyDay("2026-08-30", 30).reverse());
    expect(keep).toContain("splits-2026-06-01");
    expect(keep).toContain("splits-2026-07-01");
    expect(remove).toContain("splits-2026-06-02");
  });

  it("never touches a release that is not a split release", () => {
    const {keep, remove} = partition(["v1.0.0", "feed-2026-09-01", ...everyDay("2026-01-01", 200)]);

    expect([...keep, ...remove]).not.toContain("v1.0.0");
    expect([...keep, ...remove]).not.toContain("feed-2026-09-01");
  });

});
