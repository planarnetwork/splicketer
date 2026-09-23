import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/** Where the site is served from on GitHub Pages. The dev server serves from the root. */
const BASE = "/splicketer/";

export default defineConfig(({ command, isPreview }) => ({
  base: command === "build" || isPreview ? BASE : "/",
  plugins: [react()],
  build: { target: "es2022", sourcemap: true },
  worker: { format: "es" },
  // the split file reader is the library's own, from the package above
  server: { fs: { allow: [".."] } },
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"] }
}));
