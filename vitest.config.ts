import { defineConfig } from "vitest/config";

// Frontend tests only. The backend has its own runner and its own configs
// (server/vitest.config.ts and server/vitest.integration.config.ts); the
// integration suite needs a live database and must not be pulled in here.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules/**", "server/**", "dist/**"],
    environment: "node",
  },
});
