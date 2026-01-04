import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    // Run tests sequentially to avoid conflicts with the single active session constraint
    pool: "forks",
    maxWorkers: 1,
    isolate: false,
    // Ensure tests run one at a time
    sequence: {
      concurrent: false,
    },
  },
});
