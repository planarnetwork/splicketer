import { CODE_WIDTH, NONE_SHARED, PRICE_SEPARATOR, ROUTE_SEPARATOR, SECTION } from "../output/SplitFormat.js";

/**
 * The split journeys of one category as a tree per origin: each node is a station reached from its parent on a
 * separate ticket, and every journey in the file ends at a node, found through a table of origin by destination.
 */
interface CategoryTree {
  readonly nodeStation: Uint16Array;
  readonly nodeParent: Int32Array;
  /** the stations the table covers */
  readonly size: number;
  /** node the journey from origin to destination ends at, origin * size + destination, or -1 */
  readonly journeys: Int32Array;
  /** route of the journey from origin to destination, an index into the repository's routes */
  readonly journeyRoutes: Uint16Array;
}

/**
 * Where to split a journey, and the route the tickets are for: any permitted tickets, or any permitted and route
 * specific tickets of this route
 */
export interface Split {
  readonly route: string;
  readonly points: string[];
}

/**
 * The split journeys written by build-splits, held compactly enough to answer lookups in real time
 */
export class SplitRepository {

  private constructor(
    private readonly stations: readonly string[],
    private readonly stationIds: ReadonlyMap<string, number>,
    private readonly routes: readonly string[],
    private readonly trees: ReadonlyMap<string, CategoryTree>
  ) {}

  /**
   * Read a split file from the decompressed bytes of it, as they arrive. This works the same in a browser and in node:
   * loadSplitFile reads one from disk.
   */
  public static async fromStream(chunks: AsyncIterable<Uint8Array>): Promise<SplitRepository> {
    const decoder = new TextDecoder("latin1");
    const loader = new Loader();
    let remainder = "";

    for await (const chunk of chunks) {
      const text = remainder + decoder.decode(chunk, {stream: true});
      let start = 0;

      for (let end = text.indexOf("\n"); end !== -1; end = text.indexOf("\n", start)) {
        loader.add(text, start, end);
        start = end + 1;
      }

      remainder = text.slice(start);
    }

    remainder += decoder.decode();
    loader.add(remainder, 0, remainder.length);

    return SplitRepository.from(loader);
  }

  public static fromLines(lines: Iterable<string>): SplitRepository {
    const loader = new Loader();

    for (const line of lines) {
      loader.add(line, 0, line.length);
    }

    return SplitRepository.from(loader);
  }

  private static from(loader: Loader): SplitRepository {
    const {stations, stationIds, routes, trees} = loader.finish();

    return new SplitRepository(stations, stationIds, routes, trees);
  }

  public get categories(): string[] {
    return [...this.trees.keys()];
  }

  /**
   * Where to split a journey and the route of its tickets, or undefined if the through fare is the cheapest
   */
  public split(category: string, origin: string, destination: string): Split | undefined {
    const tree = this.trees.get(category);
    const from = this.stationIds.get(origin);
    const to = this.stationIds.get(destination);

    if (tree === undefined || from === undefined || to === undefined || from >= tree.size || to >= tree.size) {
      return undefined;
    }

    const journey = from * tree.size + to;
    const end = tree.journeys[journey];

    if (end === -1) {
      return undefined;
    }

    const points: string[] = [];

    for (let node = tree.nodeParent[end]; tree.nodeParent[node] !== -1; node = tree.nodeParent[node]) {
      points.push(this.stations[tree.nodeStation[node]]);
    }

    return {route: this.routes[tree.journeyRoutes[journey]], points: points.reverse()};
  }

}

/**
 * Reads the lines of a split file, one category at a time. Lines are read in place from the text they are in.
 */
class Loader {

  private readonly stations: string[] = [];
  private readonly stationIds = new Map<string, number>();
  private readonly stationByKey = new Int32Array(KEYS).fill(-1);
  private readonly routes: string[] = [];
  private readonly trees = new Map<string, CategoryTree>();
  private builder: TreeBuilder | undefined;
  private category = "";

  public add(text: string, start: number, end: number): void {
    if (end === start) {
      return;
    }
    if (text.startsWith(SECTION, start)) {
      const header = text.slice(start + SECTION.length, end);
      const separator = header.indexOf(ROUTE_SEPARATOR);
      const category = header.slice(0, separator);
      const route = header.slice(separator + ROUTE_SEPARATOR.length);

      if (category !== this.category || this.builder === undefined) {
        this.finishCategory();
        this.category = category;
        this.builder = new TreeBuilder(this.stationId);
      }

      this.builder.startSection(this.routeId(route));
    }
    else {
      this.builder?.add(text, start, end);
    }
  }

  public finish(): {stations: string[], stationIds: Map<string, number>, routes: string[], trees: Map<string, CategoryTree>} {
    this.finishCategory();

    return {stations: this.stations, stationIds: this.stationIds, routes: this.routes, trees: this.trees};
  }

  private routeId(route: string): number {
    const id = this.routes.indexOf(route);

    return id === -1 ? this.routes.push(route) - 1 : id;
  }

  private finishCategory(): void {
    if (this.builder !== undefined) {
      this.trees.set(this.category, this.builder.build(this.stations.length));
      this.builder = undefined;
    }
  }

  private readonly stationId = (text: string, position: number): number => {
    const key = codeKey(text, position);
    let id = this.stationByKey[key];

    if (id === -1) {
      const code = text.slice(position, position + CODE_WIDTH);

      id = this.stations.length;
      this.stationByKey[key] = id;
      this.stationIds.set(code, id);
      this.stations.push(code);
    }

    return id;
  };

}

const SEPARATOR = PRICE_SEPARATOR.charCodeAt(0);

/** Station codes are three characters, each a letter or digit */
const KEYS = 36 ** 3;

function codeKey(text: string, position: number): number {
  return (charKey(text.charCodeAt(position)) * 36 + charKey(text.charCodeAt(position + 1))) * 36 + charKey(text.charCodeAt(position + 2));
}

function charKey(code: number): number {
  return code >= 65 ? code - 55 : code - 48;
}

/**
 * Builds a category's tree from its front coded lines. They arrive sorted, so each origin's lines are together and a
 * line only adds stations after those it shares with the line before, which are still on the stack of the path so
 * far.
 */
class TreeBuilder {

  private readonly nodeStation = new GrowableArray(size => new Uint16Array(size));
  private readonly nodeParent = new GrowableArray(size => new Int32Array(size));
  private readonly origins = new GrowableArray(size => new Uint16Array(size));
  private readonly ends = new GrowableArray(size => new Int32Array(size));
  private readonly endRoutes = new GrowableArray(size => new Uint16Array(size));
  private readonly path: number[] = [];
  private route = 0;

  constructor(private readonly stationId: (text: string, position: number) => number) {}

  /**
   * A section's lines share nothing with the lines of the section before it
   */
  public startSection(route: number): void {
    this.route = route;
    this.path.length = 0;
  }

  public add(text: string, start: number, end: number): void {
    let pathEnd = start + 1;

    while (pathEnd < end && text.charCodeAt(pathEnd) !== SEPARATOR) {
      pathEnd++;
    }

    this.path.length = Math.min(this.path.length, text.charCodeAt(start) - NONE_SHARED);

    for (let i = start + 1; i < pathEnd; i += CODE_WIDTH) {
      this.nodeStation.push(this.stationId(text, i));
      this.nodeParent.push(this.path.length === 0 ? -1 : this.path[this.path.length - 1]);
      this.path.push(this.nodeStation.length - 1);
    }

    this.origins.push(this.nodeStation.values[this.path[0]]);
    this.ends.push(this.path[this.path.length - 1]);
    this.endRoutes.push(this.route);
  }

  public build(size: number): CategoryTree {
    const origins = this.origins.values;
    const ends = this.ends.values;
    const endRoutes = this.endRoutes.values;
    const nodeStation = this.nodeStation.values;
    const journeys = new Int32Array(size * size).fill(-1);
    const journeyRoutes = new Uint16Array(size * size);

    for (let i = 0; i < this.ends.length; i++) {
      const journey = origins[i] * size + nodeStation[ends[i]];

      journeys[journey] = ends[i];
      journeyRoutes[journey] = endRoutes[i];
    }

    return {
      nodeStation: this.nodeStation.toArray(),
      nodeParent: this.nodeParent.toArray(),
      size,
      journeys,
      journeyRoutes
    };
  }

}

type TypedArray = Uint16Array | Int32Array;

class GrowableArray<T extends TypedArray> {

  public values: T;
  public length = 0;

  constructor(private readonly create: (size: number) => T) {
    this.values = create(1 << 16);
  }

  public push(value: number): void {
    if (this.length === this.values.length) {
      const grown = this.create(this.length * 2);
      grown.set(this.values as never);
      this.values = grown;
    }

    this.values[this.length++] = value;
  }

  public toArray(): T {
    return this.values.slice(0, this.length) as T;
  }

}
