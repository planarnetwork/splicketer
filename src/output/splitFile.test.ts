import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codeBlock, writeSplitFile } from "./splitFile.js";

describe("codeBlock", () => {

  it("sorts a block's paths and front codes them", () => {
    expect(codeBlock(["NRWELYCBG", "NRWDISSMKIPS", "NRWDISLST"])).toBe("0NRWDISLST\n2SMKIPS\n1ELYCBG");
  });

  it("codes nothing as an empty block", () => {
    expect(codeBlock([])).toBe("");
  });

});

describe("writeSplitFile", () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "split-file"));
  });

  afterEach(() => {
    fs.rmSync(directory, {recursive: true, force: true});
  });

  const sections = () => [
    {category: "ANY-S", route: "00000", blocks: ["0NRWDISLST", "", "0YRKDONKGX"]},
    {category: "ANY-S", route: "00700", blocks: ["0NRWELYCBG"]}
  ];

  it("writes a line for each section and then its blocks, leaving out empty ones", async () => {
    const file = path.join(directory, "splits.br");
    const bytes = await writeSplitFile(file, sections());

    expect(zlib.brotliDecompressSync(fs.readFileSync(file)).toString()).toBe(
      "#ANY-S 00000\n0NRWDISLST\n0YRKDONKGX\n#ANY-S 00700\n0NRWELYCBG\n"
    );
    expect(bytes).toBe(fs.statSync(file).size);
  });

  it("writes gzip when the name ends in .gz", async () => {
    const file = path.join(directory, "splits.gz");

    await writeSplitFile(file, sections());

    expect(zlib.gunzipSync(fs.readFileSync(file)).toString()).toContain("#ANY-S 00700\n");
  });

});
