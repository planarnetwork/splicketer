import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lines, splitsMeta } from "./mergeSplits.js";

describe("lines", () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "merge-splits"));
  });

  afterEach(() => {
    fs.rmSync(directory, {recursive: true, force: true});
  });

  it.each([
    ["splits.br", (text: string) => zlib.brotliCompressSync(text)],
    ["splits.gz", (text: string) => zlib.gzipSync(text)],
    ["splits.txt", (text: string) => Buffer.from(text)]
  ])("reads the lines of %s", async (name, encode) => {
    const file = path.join(directory, name);

    fs.writeFileSync(file, encode("#ANY-S 00000\r\n0NRWDISLST\n"));

    const read: string[] = [];

    for await (const line of lines(file)) {
      read.push(line);
    }

    expect(read).toEqual(["#ANY-S 00000", "0NRWDISLST"]);
  });

  it("does not open the file until it is read", () => {
    expect(() => lines(path.join(directory, "missing.br"))).not.toThrow();
  });

});

describe("splitsMeta", () => {

  it("totals the journeys of each category's sections", () => {
    const meta = splitsMeta(new Map([["ANY-S 00000", 3], ["ANY-S 00700", 2], ["OFP-R 00000", 4]]), "2026-09-22", "abc123");

    expect(meta).toEqual({
      date: "2026-09-22",
      built: expect.any(String),
      commit: "abc123",
      journeys: 9,
      categories: {"ANY-S": 5, "OFP-R": 4}
    });
  });

});
