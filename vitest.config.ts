import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      [
        "shared",
        "engine",
        "db",
        "paypal",
        "agents",
        "calls",
        "bots",
        "partners",
      ].map((n) => [
        "@switchboard/" + n,
        fileURLToPath(
          new URL("./packages/" + n + "/src/index.ts", import.meta.url),
        ),
      ]),
    ),
  },
  test: {
    include: [
      "packages/**/*.test.ts",
      "tests/**/*.test.ts",
      "apps/worker/**/*.test.ts",
      "apps/web/**/*.test.ts",
    ],
    fileParallelism: false,
  },
});
