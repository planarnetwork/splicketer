/// <reference lib="webworker" />
import { SplitRepository } from "../../../src/query/SplitRepository";
import { readable } from "./brotli";
import type { SplitsRequest, SplitsResponse } from "./protocol";

/**
 * Reads the split file off the main thread: it is 150MB of text once decompressed, and parsing it would freeze the
 * page for seconds. Once read, it answers lookups.
 */
let repository: SplitRepository | undefined;

const post = (message: SplitsResponse) => self.postMessage(message);

self.onmessage = async (event: MessageEvent<SplitsRequest>) => {
  const request = event.data;

  if (request.type === "load") {
    try {
      repository = await load(request.url);
      post({type: "ready", categories: repository.categories});
    }
    catch (error) {
      post({type: "error", message: error instanceof Error ? error.message : String(error)});
    }
  }
  else if (request.type === "query" && repository !== undefined) {
    const found = repository;

    post({
      type: "result",
      id: request.id,
      splits: found.categories.map(category => ({category, split: found.split(category, request.origin, request.destination)}))
    });
  }
};

async function load(url: string): Promise<SplitRepository> {
  const response = await fetch(url);

  if (!response.ok || response.body === null) {
    throw new Error(`The split file could not be fetched: ${response.status} ${response.statusText}`);
  }

  const total = Number(response.headers.get("content-length")) || undefined;
  let received = 0;
  const counted = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.length;
      post({type: "progress", received, total});
      controller.enqueue(chunk);
    }
  }));
  const gunzip = new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>;
  const bytes = url.endsWith(".gz") ? counted.pipeThrough(gunzip) : await readable(counted);

  return SplitRepository.fromStream(chunks(bytes));
}

/**
 * A stream's chunks as an async iterable, for browsers where streams are not iterable themselves
 */
async function* chunks(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();

  for (;;) {
    const {done, value} = await reader.read();

    if (done) {
      return;
    }

    yield value;
  }
}
