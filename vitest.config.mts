import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    // Each test file gets its own process and its own SQLite file (see
    // tests/helpers/test-db.ts), so suites can't corrupt each other's data
    // or the demo database.
    pool: "forks",
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
  },
});
