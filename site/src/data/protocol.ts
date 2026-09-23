import type { Split } from "../../../src/query/SplitRepository";

export type SplitsRequest =
  | {type: "load", url: string}
  | {type: "query", id: number, origin: string, destination: string};

export interface CategorySplit {
  readonly category: string;
  readonly split: Split | undefined;
}

export type SplitsResponse =
  | {type: "progress", received: number, total: number | undefined}
  | {type: "ready", categories: string[]}
  | {type: "error", message: string}
  | {type: "result", id: number, splits: CategorySplit[]};
