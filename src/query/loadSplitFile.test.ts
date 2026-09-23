import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSplitFile } from "./loadSplitFile.js";

const CONTENT = "#ANY-S 00000\n0NRWDISLST\n2SMKIPS\n";

describe("loadSplitFile", () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "load-split-file"));
  });

  afterEach(() => {
    fs.rmSync(directory, {recursive: true, force: true});
  });

  it.each([
    ["splits.br", (text: string) => zlib.brotliCompressSync(text)],
    ["splits.gz", (text: string) => zlib.gzipSync(text)],
    ["splits.txt", (text: string) => Buffer.from(text)]
  ])("reads %s", async (name, encode) => {
    const file = path.join(directory, name);

    fs.writeFileSync(file, encode(CONTENT));

    const repository = await loadSplitFile(file);

    expect(repository.split("ANY-S", "NRW", "IPS")).toEqual({route: "00000", points: ["DIS", "SMK"]});
  });

});
