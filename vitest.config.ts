import { defineConfig } from "vitest/config";

// Vite's bundler doesn't recognize the newer `node:sqlite` built-in (and
// strips the `node:` prefix, then fails on a bare `sqlite`). Redirect any
// import of it to a tiny virtual module that pulls the real thing through
// Node's own require at runtime, bypassing Vite's resolver entirely.
const VIRTUAL = "\0node-sqlite-shim";

export default defineConfig({
  plugins: [
    {
      name: "node-sqlite-shim",
      enforce: "pre",
      resolveId(id) {
        if (id === "node:sqlite" || id === "sqlite") return VIRTUAL;
      },
      load(id) {
        if (id === VIRTUAL) {
          return [
            'import { createRequire } from "node:module";',
            "const require = createRequire(import.meta.url);",
            'const m = require("node:sqlite");',
            "export const DatabaseSync = m.DatabaseSync;",
            "export default m;",
          ].join("\n");
        }
      },
    },
  ],
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
