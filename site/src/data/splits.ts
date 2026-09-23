import type { CategorySplit, SplitsRequest, SplitsResponse } from "./protocol";

export type { CategorySplit } from "./protocol";

/**
 * The split file, read in a worker and asked about from the page
 */
export class Splits {

  private readonly worker = new Worker(new URL("./splits.worker.ts", import.meta.url), {type: "module"});
  private readonly pending = new Map<number, (splits: CategorySplit[]) => void>();
  private nextId = 0;

  constructor(
    url: string,
    onProgress: (received: number, total: number | undefined) => void,
    onReady: (categories: string[]) => void,
    onError: (message: string) => void
  ) {
    this.worker.onmessage = (event: MessageEvent<SplitsResponse>) => {
      const message = event.data;

      if (message.type === "progress") {
        onProgress(message.received, message.total);
      }
      else if (message.type === "ready") {
        onReady(message.categories);
      }
      else if (message.type === "error") {
        onError(message.message);
      }
      else {
        this.pending.get(message.id)?.(message.splits);
        this.pending.delete(message.id);
      }
    };

    this.send({type: "load", url});
  }

  /**
   * Where to split a journey in each category, or undefined where the through ticket is cheapest
   */
  public query(origin: string, destination: string): Promise<CategorySplit[]> {
    const id = this.nextId++;

    return new Promise(resolve => {
      this.pending.set(id, resolve);
      this.send({type: "query", id, origin, destination});
    });
  }

  public close(): void {
    this.worker.terminate();
  }

  private send(request: SplitsRequest): void {
    this.worker.postMessage(request);
  }

}
