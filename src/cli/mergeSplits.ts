import * as fs from "node:fs";
import * as readline from "node:readline";
import { parseArgs } from "node:util";
import * as zlib from "node:zlib";
import { mergeSplitFiles } from "../output/mergeSplitFiles.js";

/**
 * Join shard files into one, and write what it holds as metadata for the release
 */
async function main(): Promise<void> {
  const {positionals, values} = parseArgs({
    allowPositionals: true,
    options: {
      meta: {type: "string"},
      date: {type: "string", default: new Date().toISOString().slice(0, 10)}
    }
  });
  const [output, ...inputs] = positionals;

  if (output === undefined || inputs.length === 0) {
    throw new Error("Usage: merge-splits <output.br|output.gz> <shard files in origin order...> [--meta=splits-meta.json] [--date=YYYY-MM-DD]");
  }

  const journeys = await mergeSplitFiles(output, inputs.map(lines));
  const total = [...journeys.values()].reduce((a, b) => a + b, 0);

  console.log(`merged ${inputs.length} files into ${output}: ${total} split journeys in ${journeys.size} sections`);

  if (values.meta !== undefined) {
    fs.writeFileSync(values.meta, JSON.stringify(splitsMeta(journeys, values.date, process.env.GITHUB_SHA), null, 2));
  }
}

/**
 * What a release holds: the date its fares are for, when and from what it was built, and how many journeys it has in
 * each category
 */
export function splitsMeta(journeys: ReadonlyMap<string, number>, date: string, commit: string | undefined) {
  const categories: Record<string, number> = {};

  for (const [section, count] of journeys) {
    const category = section.split(" ")[0];
    categories[category] = (categories[category] ?? 0) + count;
  }

  return {
    date,
    built: new Date().toISOString(),
    commit,
    journeys: [...journeys.values()].reduce((a, b) => a + b, 0),
    categories
  };
}

/**
 * The lines of a file, opened only when they are first read so the files are read one after another
 */
export async function* lines(path: string): AsyncGenerator<string> {
  const file = fs.createReadStream(path);
  const stream = path.endsWith(".gz") ? file.pipe(zlib.createGunzip())
    : path.endsWith(".br") ? file.pipe(zlib.createBrotliDecompress())
    : file;

  yield* readline.createInterface({input: stream, crlfDelay: Infinity});
}

if (import.meta.filename === process.argv[1]) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
