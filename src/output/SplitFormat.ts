/** Characters in a station code. Every code is this wide, so a line is cut up rather than split */
export const CODE_WIDTH = 3;

/**
 * The character a shared count of nothing is written as. Counting up from it rather than writing a digit means a count
 * above nine carries on past `9` instead of overflowing.
 */
export const NONE_SHARED = "0".charCodeAt(0);

/** Starts the line naming the category and route the lines after it belong to */
export const SECTION = "#";

/** Separates the category from the route in a section line */
export const ROUTE_SEPARATOR = " ";

/** Separates a path from its price when prices are written */
export const PRICE_SEPARATOR = " ";

/**
 * How hard the file is compressed. The front coded lines repeat a lot at a distance, so a large window and a high
 * quality halve the size compared with quality 5, for about four seconds more on a full network.
 */
export const BROTLI_QUALITY = 9;
export const BROTLI_WINDOW_BITS = 24;

export type SplitCompression = "brotli" | "gzip";

/** What a file called this is compressed with. `.gz` is gzip and anything else is brotli */
export function compressionFor(name: string): SplitCompression {
  return name.endsWith(".gz") ? "gzip" : "brotli";
}

/**
 * Writes sorted paths as the tree they describe, each saying how many leading stations it shares with the one before
 * it and then the rest. A price after the path is carried along untouched.
 */
export class FrontCoder {

  private previous = "";

  public code(line: string): string {
    const end = line.indexOf(PRICE_SEPARATOR);
    const path = end === -1 ? line : line.slice(0, end);
    const limit = Math.min(path.length, this.previous.length);
    let same = 0;

    while (same < limit && path.charCodeAt(same) === this.previous.charCodeAt(same)) {
      same++;
    }

    const shared = Math.floor(same / CODE_WIDTH);

    this.previous = path;

    return String.fromCharCode(NONE_SHARED + shared) + line.slice(shared * CODE_WIDTH);
  }

}

/**
 * Reverses the FrontCoder, turning each coded line back into the full path and optional price
 */
export class FrontDecoder {

  private previous = "";

  public decode(coded: string): {path: string, price: number | undefined} {
    const shared = (coded.charCodeAt(0) - NONE_SHARED) * CODE_WIDTH;
    const rest = coded.slice(1);
    const end = rest.indexOf(PRICE_SEPARATOR);
    const path = this.previous.slice(0, shared) + (end === -1 ? rest : rest.slice(0, end));

    this.previous = path;

    return {path, price: end === -1 ? undefined : Number(rest.slice(end + 1))};
  }

}
