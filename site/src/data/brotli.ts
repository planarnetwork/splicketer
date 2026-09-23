import init, {
  type BrotliStreamResult,
  BrotliStreamResultCode,
  DecompressStream,
} from 'brotli-dec-wasm/web';

/**
 * Brotli, for a browser that has none.
 *
 * `DecompressionStream` takes gzip, deflate and deflate-raw and no more — Chrome answers
 * `Unsupported compression format: 'brotli'` — so a page handed a brotli file cannot read it.
 * Nor does serving it with `Content-Encoding: br` help by itself: the browser does decode the body,
 * but GitHub Pages never sends that header for a stored `.br`, and where a host does, the browser
 * strips it off the response so nothing downstream can tell.
 *
 * So the decoder is brought along: 204KB of wasm, decode only. It is loaded in the worker that
 * reads the split file, and only when the file turns out to need it, so a file published as gzip
 * or plain text never pays for it.
 */

/**
 * The wasm, loaded once and only when something needs it.
 *
 * Left to itself the module fetches `brotli_dec_wasm_bg.wasm` beside itself, which the bundler
 * rewrites to the emitted asset. A caller that has the bytes already can `initSync` them first, and
 * this then finds it ready.
 */
let ready: Promise<unknown> | undefined;
const wasm = (): Promise<unknown> => (ready ??= init());

/** How much to ask the decoder for at a time. Big enough that a 150MB file is not a million calls. */
const OUTPUT_SIZE = 1 << 20;

/** Enough of the front of a file to tell what it is. */
const SNIFF_WIDTH = 4;

const GZIP = [0x1f, 0x8b, 0x08];

/** A plain split file starts with its first section line */
const SECTION = 0x23;

/**
 * Whether these bytes need brotli.
 *
 * Everything else is left alone: gzip announces itself, and a plain split file starts with `#`.
 * Only what is neither is treated as brotli, which is what the file is written with.
 */
export function looksBrotli(head: Uint8Array): boolean {
  if (head.length === 0) return false;
  if (GZIP.every((byte, i) => head[i] === byte)) return false;

  return head[0] !== SECTION;
}

/**
 * Brotli as a TransformStream, so it goes where `DecompressionStream` would and the file is read as
 * it downloads rather than after it has all been collected.
 *
 * The decoder is fed a chunk and asked for output until it says it wants more input: one chunk in
 * can be many out, since front coded lines compress hard.
 */
export function brotliDecompressionStream(): TransformStream<Uint8Array, Uint8Array> {
  let decoder: DecompressStream;

  const pump = (input: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) => {
    let rest = input;

    for (;;) {
      const result: BrotliStreamResult = decoder.decompress(rest, OUTPUT_SIZE);
      if (result.buf.length > 0) controller.enqueue(result.buf);

      // More output than one call could hold: feed it what it has not read yet and go again.
      if (result.code === BrotliStreamResultCode.NeedsMoreOutput) {
        rest = rest.subarray(result.input_offset);
        continue;
      }
      // Either it wants the next chunk, or the file is done. Both mean stop here.
      return;
    }
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    async start() {
      await wasm();
      decoder = new DecompressStream();
    },
    transform(chunk, controller) {
      pump(chunk, controller);
    },
    flush(controller) {
      // Whatever is still held in the decoder, drawn out with no more input to give it.
      pump(new Uint8Array(0), controller);
    },
  });
}

/**
 * The bytes of a split file, decompressed if it is brotli and untouched if it is not.
 *
 * The front of the file is read to decide, then given back, so the rest is still read as it
 * arrives. Anything the environment can handle itself — gzip, or a file already plain — is passed
 * along for the loader to deal with as it would.
 */
export async function readable(
  body: ReadableStream<Uint8Array>,
): Promise<ReadableStream<Uint8Array>> {
  const reader = body.getReader();
  const head: Uint8Array[] = [];
  let size = 0;

  while (size < SNIFF_WIDTH) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value.length === 0) continue;
    head.push(value);
    size += value.length;
  }

  const front = join(head, size);
  const whole = rejoined(front, reader);

  return looksBrotli(front) ? whole.pipeThrough(brotliDecompressionStream()) : whole;
}

/** The file again: the bytes the sniff took, and then the rest of them. */
function rejoined(front: Uint8Array, reader: ReadableStreamDefaultReader<Uint8Array>) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (front.length > 0) controller.enqueue(front);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    // A fetch that is abandoned should stop, rather than being left reading.
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function join(chunks: readonly Uint8Array[], size: number): Uint8Array {
  if (chunks.length === 1) return chunks[0]!;
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
