import * as fs from "node:fs";
import * as zlib from "node:zlib";
import { SplitRepository } from "./SplitRepository.js";

/**
 * Load a split file from disk, brotli or gzip compressed according to its name, or plain text
 */
export function loadSplitFile(path: string): Promise<SplitRepository> {
  const file = fs.createReadStream(path, {highWaterMark: 1 << 20});
  const stream = path.endsWith(".gz") ? file.pipe(zlib.createGunzip({chunkSize: 1 << 20}))
    : path.endsWith(".br") ? file.pipe(zlib.createBrotliDecompress({chunkSize: 1 << 20}))
    : file;

  return SplitRepository.fromStream(stream);
}
