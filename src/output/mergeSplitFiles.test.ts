import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codeBlock, writeSplitFile } from "./splitFile.js";
import { mergeSplitFiles } from "./mergeSplitFiles.js";

describe("mergeSplitFiles", () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "merge"));
  });

  afterEach(() => {
    fs.rmSync(directory, {recursive: true, force: true});
  });

  async function write(name: string, sections: [category: string, route: string, origins: string[][]][]): Promise<string> {
    const file = path.join(directory, name);

    await writeSplitFile(file, sections.map(([category, route, origins]) => ({category, route, blocks: origins.map(codeBlock)})));

    return file;
  }

  function* lines(file: string): Generator<string> {
    yield* zlib.gunzipSync(fs.readFileSync(file)).toString("latin1").split("\n");
  }

  async function* asAsync(file: string): AsyncGenerator<string> {
    yield* lines(file);
  }

  it("gives the same file as building every origin at once", async () => {
    const first = await write("1.gz", [["ANY-S", "00000", [["AAAXXXBBB"]]], ["ANY-S", "00700", [["AAAYYYCCC"]]]]);
    const second = await write("2.gz", [["ADV-S", "00000", [["NRWDISLST"]]], ["ANY-S", "00000", [["NRWDISIPS", "NRWDISLST"]]]]);
    const whole = await write("whole.gz", [
      ["ADV-S", "00000", [["NRWDISLST"]]],
      ["ANY-S", "00000", [["AAAXXXBBB"], ["NRWDISIPS", "NRWDISLST"]]],
      ["ANY-S", "00700", [["AAAYYYCCC"]]]
    ]);
    const merged = path.join(directory, "merged.gz");

    const journeys = await mergeSplitFiles(merged, [asAsync(first), asAsync(second)]);

    expect([...lines(merged)]).toEqual([...lines(whole)]);
    expect(Object.fromEntries(journeys)).toEqual({"ADV-S 00000": 1, "ANY-S 00000": 3, "ANY-S 00700": 1});
  });
});
