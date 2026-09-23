import { CATEGORIES } from "../fares/Category.js";
import { ROUTE_SEPARATOR, SECTION } from "./SplitFormat.js";
import { type SplitSection, writeSplitFile } from "./SplitFile.js";

/**
 * Join split files built from contiguous runs of origins, given in the order of their origins, into one. Each
 * section's lines from one file are joined to its lines from the next without recoding, which holds because every
 * origin's lines start by sharing nothing with the line before.
 *
 * Returns the number of journeys in each section.
 */
export async function mergeSplitFiles(output: string, inputs: AsyncIterable<string>[]): Promise<Map<string, number>> {
  const sections = new Map<string, {category: string, route: string, blocks: string[], journeys: number}>();

  for (const input of inputs) {
    let lines: string[] = [];
    let section: {blocks: string[], journeys: number} | undefined;

    const flush = () => {
      if (section !== undefined && lines.length > 0) {
        section.blocks.push(lines.join("\n"));
        section.journeys += lines.length;
      }
      lines = [];
    };

    for await (const line of input) {
      if (line.startsWith(SECTION)) {
        flush();

        const header = line.slice(SECTION.length);
        const [category, route] = header.split(ROUTE_SEPARATOR);

        section = sections.get(header) ?? {category, route, blocks: [], journeys: 0};
        sections.set(header, section as never);
      }
      else if (line !== "") {
        lines.push(line);
      }
    }

    flush();
  }

  const ordered = [...sections.values()].sort((a, b) =>
    CATEGORIES.indexOf(a.category as never) - CATEGORIES.indexOf(b.category as never) || a.route.localeCompare(b.route)
  );
  const size = ordered.reduce((total, s) => total + s.blocks.reduce((n, block) => n + block.length + 1, 0), 0);

  await writeSplitFile(output, ordered.map(({category, route, blocks}): SplitSection => ({category, route, blocks})), size);

  return new Map(ordered.map(s => [`${s.category}${ROUTE_SEPARATOR}${s.route}`, s.journeys]));
}
