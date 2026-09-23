import * as fs from "node:fs";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import * as zlib from "node:zlib";
import { BROTLI_QUALITY, BROTLI_WINDOW_BITS, compressionFor, FrontCoder, ROUTE_SEPARATOR, SECTION } from "./SplitFormat.js";

/**
 * The split journeys of one category on one route, as blocks of front coded lines in the order they are to be written
 */
export interface SplitSection {
  readonly category: string;
  readonly route: string;
  readonly blocks: Iterable<string>;
}

/**
 * Sort a set of paths and front code them as one block. Blocks can be joined without recoding as long as each starts
 * with a station the block before it does not end with, which holds for the paths from one origin.
 */
export function codeBlock(lines: string[]): string {
  const coder = new FrontCoder();

  return lines.sort().map(line => coder.code(line)).join("\n");
}

/**
 * Write every section of split journeys to one compressed file: a `#CATEGORY ROUTE` line then the section's blocks.
 * The sections of a category must be together.
 *
 * Brotli compresses smaller when told roughly how much is coming, hence the size hint.
 */
export async function writeSplitFile(path: string, sections: readonly SplitSection[], sizeHint: number = 0): Promise<number> {
  const compress = compressionFor(path) === "gzip"
    ? zlib.createGzip()
    : zlib.createBrotliCompress({params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
      [zlib.constants.BROTLI_PARAM_LGWIN]: BROTLI_WINDOW_BITS,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: sizeHint
    }});
  const output = fs.createWriteStream(path);

  compress.pipe(output);

  for (const section of sections) {
    await write(compress, `${SECTION}${section.category}${ROUTE_SEPARATOR}${section.route}\n`);

    for (const block of section.blocks) {
      if (block !== "") {
        await write(compress, `${block}\n`);
      }
    }
  }

  compress.end();
  await finished(output);

  return output.bytesWritten;
}

async function write(stream: zlib.BrotliCompress | zlib.Gzip, text: string): Promise<void> {
  if (!stream.write(text)) {
    await once(stream, "drain");
  }
}
