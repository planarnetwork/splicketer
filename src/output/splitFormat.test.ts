import { describe, expect, it } from "vitest";
import { FrontCoder, FrontDecoder } from "./splitFormat.js";

describe("FrontCoder", () => {

  it("writes how many stations each path shares with the one before it", () => {
    const coder = new FrontCoder();

    expect(["NRWDISLST", "NRWDISSMKIPS", "NRWELYCBG"].map(line => coder.code(line))).toEqual(["0NRWDISLST", "2SMKIPS", "1ELYCBG"]);
  });

  it("only counts whole stations", () => {
    const coder = new FrontCoder();

    coder.code("NRWDISLST");

    expect(coder.code("NRWDIXLST")).toBe("1DIXLST");
  });

  it("carries a price after the path", () => {
    const coder = new FrontCoder();

    expect(["NRWDISLST 1234", "NRWDISSMK 999"].map(line => coder.code(line))).toEqual(["0NRWDISLST 1234", "2SMK 999"]);
  });

  it("is reversed by the decoder", () => {
    const lines = ["AAABBBCCC 10", "AAABBBDDDEEE 20", "AAAFFFGGG 30", "HHHIIIJJJ 40"];
    const coder = new FrontCoder();
    const decoder = new FrontDecoder();

    expect(lines.map(line => coder.code(line)).map(line => decoder.decode(line))).toEqual([
      {path: "AAABBBCCC", price: 10},
      {path: "AAABBBDDDEEE", price: 20},
      {path: "AAAFFFGGG", price: 30},
      {path: "HHHIIIJJJ", price: 40}
    ]);
  });

});
