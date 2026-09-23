import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codeBlock, writeSplitFile } from "../output/SplitFile.js";
import { loadSplitFile } from "./loadSplitFile.js";
import type { SplitRepository } from "./SplitRepository.js";

describe("SplitRepository", () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "splits"));
  });

  afterEach(() => {
    fs.rmSync(directory, {recursive: true, force: true});
  });

  async function roundTrip(name: string, sections: [category: string, route: string, origins: string[][]][]): Promise<SplitRepository> {
    const file = path.join(directory, name);

    await writeSplitFile(file, sections.map(([category, route, origins]) => ({category, route, blocks: origins.map(codeBlock)})));

    return loadSplitFile(file);
  }

  it("finds the split points and route of a journey written to a brotli file", async () => {
    const repository = await roundTrip("splits.br", [
      ["ANY-S", "00000", [["NRWDISSMKIPS", "NRWDISLST"], ["YRKDONPBOKGX"]]],
      ["ANY-S", "00700", [["NRWELYCBG"], ["YRKNTRNCL"]]],
      ["OFP-S", "00000", [["NRWDISIPS 1234"]]]
    ]);

    expect(repository.categories).toEqual(["ANY-S", "OFP-S"]);
    expect(repository.split("ANY-S", "NRW", "IPS")).toEqual({route: "00000", points: ["DIS", "SMK"]});
    expect(repository.split("ANY-S", "NRW", "LST")).toEqual({route: "00000", points: ["DIS"]});
    expect(repository.split("ANY-S", "NRW", "CBG")).toEqual({route: "00700", points: ["ELY"]});
    expect(repository.split("ANY-S", "YRK", "KGX")).toEqual({route: "00000", points: ["DON", "PBO"]});
    expect(repository.split("ANY-S", "YRK", "NCL")).toEqual({route: "00700", points: ["NTR"]});
    expect(repository.split("OFP-S", "NRW", "IPS")).toEqual({route: "00000", points: ["DIS"]});
  });

  it("reads gzip files", async () => {
    const repository = await roundTrip("splits.gz", [["ANY-S", "00000", [["NRWDISLST"]]]]);

    expect(repository.split("ANY-S", "NRW", "LST")).toEqual({route: "00000", points: ["DIS"]});
  });

  it("has nothing for journeys where the through fare is cheapest or that are unknown", async () => {
    const repository = await roundTrip("splits.br", [["ANY-S", "00000", [["NRWDISLST"]]]]);

    expect(repository.split("ANY-S", "NRW", "DIS")).toBeUndefined();
    expect(repository.split("ANY-S", "LST", "NRW")).toBeUndefined();
    expect(repository.split("ANY-S", "XXX", "LST")).toBeUndefined();
    expect(repository.split("ADV-S", "NRW", "LST")).toBeUndefined();
  });
});
