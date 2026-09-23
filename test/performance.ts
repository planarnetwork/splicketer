import { performance } from "node:perf_hooks";
import { loadSplitFile, splitCandidates } from "../src/index.js";

const file = process.argv[2] ?? "splits.br";
let started = performance.now();
const repository = await loadSplitFile(file);

console.log(`loaded ${file} in ${(performance.now() - started).toFixed(0)}ms, heap ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB, arrays ${(process.memoryUsage().arrayBuffers / 1e6).toFixed(0)} MB`);

const patterns = [
  ["NRW", "DIS", "SMK", "IPS", "MNG", "COL", "CHM", "SRA", "LST"],
  ["EDB", "DUN", "BWK", "ALM", "MPT", "NCL", "DHM", "DAR", "NTR", "YRK", "DON", "NNG", "GRA", "PBO", "SVG", "KGX"],
  ["PNZ", "SER", "CBN", "RED", "TRU", "SAU", "PAR", "BOD", "LSK", "PLY", "TOT", "NTA", "EXD", "TVP", "TAU", "RDG", "PAD"],
  ["MAN", "SPT", "MAC", "SOT", "STA", "BHM", "COV", "RUG", "MKC", "WFJ", "EUS"]
];

for (const category of repository.categories) {
  for (const pattern of patterns) {
    const runs = 1000;

    started = performance.now();
    let candidates = new Map<string, string[]>();

    for (let i = 0; i < runs; i++) {
      candidates = splitCandidates(repository, category, pattern);
    }

    const each = (performance.now() - started) / runs;

    console.log(`${category} ${pattern[0]}-${pattern[pattern.length - 1]} ${pattern.length} stops: ${(each * 1000).toFixed(0)}µs, ${[...candidates].map(([route, stops]) => `${route}: ${stops.join(" ")}`).join(", ")}`);
  }
}
