import {execFileSync} from "node:child_process";

/**
 * Keep the split releases worth keeping, and say which. From gb-transit.
 *
 * A daily build accumulates a release a day forever. The last month is what
 * anybody actually fetches; beyond that what is wanted is the ability to say what
 * the splits looked like in April, which one release a month answers as well as
 * thirty do.
 *
 * **Only `splits-` tags are considered at all**, so a pruner can never reach a
 * release of anything else.
 */
const KEEP_RECENT = 30;
const SPLITS_TAG = /^splits-(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Split release tags into the ones to keep and the ones to delete.
 *
 * Pure, and exported, because the alternative is finding out what it decided by
 * watching it delete things.
 */
export function partition(tags, keepRecent = KEEP_RECENT) {
  const splits = tags
    .filter(tag => SPLITS_TAG.test(tag))
    // Lexicographic is chronological for YYYY-MM-DD, newest first.
    .sort()
    .reverse();

  const keep = new Set(splits.slice(0, keepRecent));

  // The earliest release of each month, rather than whichever is dated the 1st:
  // a night that failed to publish must not cost the whole month its record.
  const earliest = new Map();

  for (const tag of splits) {
    const month = tag.slice(0, "splits-YYYY-MM".length);

    if (!earliest.has(month) || tag < earliest.get(month)) {
      earliest.set(month, tag);
    }
  }

  for (const tag of earliest.values()) {
    keep.add(tag);
  }

  return {
    keep: splits.filter(tag => keep.has(tag)),
    remove: splits.filter(tag => !keep.has(tag))
  };
}

function releases() {
  const json = execFileSync("gh", [
    "release", "list", "--limit", "1000", "--json", "tagName"
  ], {encoding: "utf8"});

  return JSON.parse(json).map(release => release.tagName);
}

function main() {
  const tags = releases();
  const {keep, remove} = partition(tags);

  console.log(`${tags.length} releases, ${keep.length} split releases kept, ${remove.length} to remove`);

  if (remove.length === 0) {
    return;
  }

  for (const tag of remove) {
    console.log(`Removing ${tag}`);
    execFileSync("gh", ["release", "delete", tag, "--yes", "--cleanup-tag"], {stdio: "inherit"});
  }
}

// Only when run. Importing this to test what it would delete should not delete
// anything.
if (process.argv[1]?.endsWith("prune-releases.mjs")) {
  main();
}
