/**
 * A station as the site knows it: its CRS code, its name and where it is
 */
export interface Station {
  readonly code: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
}

/**
 * Naming and finding stations, from the stations.json the daily build writes
 */
export class Stations {

  private readonly byCode: Map<string, Station>;
  private readonly lower: {code: string, name: string, station: Station}[];

  constructor(public readonly all: readonly Station[]) {
    this.byCode = new Map(all.map(station => [station.code, station]));
    this.lower = [...all]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(station => ({code: station.code.toLowerCase(), name: station.name.toLowerCase(), station}));
  }

  public static async load(url: string): Promise<Stations> {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`The stations could not be fetched: ${response.status} ${response.statusText}`);
    }

    const rows = await response.json() as [string, string, number, number][];

    return new Stations(rows.map(([code, name, lat, lon]) => ({code, name, lat, lon})));
  }

  /**
   * Stations matching what has been typed: those whose code starts with it or whose name contains it, the earlier in
   * the name and the shorter the name the better
   */
  public match(query: string, limit = 40): Station[] {
    const q = query.trim().toLowerCase();

    if (q === "") {
      return [];
    }

    return this.lower
      .filter(at => at.code.startsWith(q) || at.name.includes(q))
      .sort((a, b) => Number(b.code === q) - Number(a.code === q) || a.name.indexOf(q) - b.name.indexOf(q) || a.name.length - b.name.length)
      .slice(0, limit)
      .map(at => at.station);
  }

  public at(code: string): Station | undefined {
    return this.byCode.get(code);
  }

  public name(code: string): string {
    return this.byCode.get(code)?.name ?? code;
  }

  /** `Norwich (NRW)` */
  public label(code: string): string {
    return `${this.name(code)} (${code})`;
  }

  /**
   * The station a field names: a label, a code or a name that matches one station best
   */
  public resolve(text: string): Station | undefined {
    const label = /\(([A-Z0-9]{3})\)\s*$/.exec(text.trim());

    return this.at(label?.[1] ?? text.trim().toUpperCase()) ?? this.match(text, 1)[0];
  }

}
