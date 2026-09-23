import * as fs from "node:fs";
import * as readline from "node:readline";
import { parseArgs } from "node:util";
import * as zlib from "node:zlib";
import { mergeSplitFiles } from "../output/mergeSplitFiles.js";

const {positionals, values} = parseArgs({
  allowPositionals: true,
  options: {
    meta: {type: "string"},
    date: {type: "string", default: new Date().toISOString().slice(0, 10)}
  }
});
const [output, ...inputs] = positionals;

if (output === undefined || inputs.length === 0) {
  console.error("Usage: merge-splits <output.br|output.gz> <shard files in origin order...> [--meta=splits-meta.json] [--date=YYYY-MM-DD]");
  process.exit(1);
}

/**
 * The lines of a file, opened only when they are first read so the files are read one after another
 */
async function* lines(path: string): AsyncGenerator<string> {
  const file = fs.createReadStream(path);
  const stream = path.endsWith(".gz") ? file.pipe(zlib.createGunzip())
    : path.endsWith(".br") ? file.pipe(zlib.createBrotliDecompress())
    : file;

  yield* readline.createInterface({input: stream, crlfDelay: Infinity});
}

const journeys = await mergeSplitFiles(output, inputs.map(lines));
const total = [...journeys.values()].reduce((a, b) => a + b, 0);

console.log(`merged ${inputs.length} files into ${output}: ${total} split journeys in ${journeys.size} sections`);

if (values.meta !== undefined) {
  const byCategory: Record<string, number> = {};

  for (const [section, count] of journeys) {
    const category = section.split(" ")[0];
    byCategory[category] = (byCategory[category] ?? 0) + count;
  }

  fs.writeFileSync(values.meta, JSON.stringify({
    date: values.date,
    built: new Date().toISOString(),
    commit: process.env.GITHUB_SHA,
    journeys: total,
    categories: byCategory
  }, null, 2));
}
