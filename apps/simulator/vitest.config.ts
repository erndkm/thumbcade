import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    environmentOptions: { happyDOM: { url: "http://localhost:5173/" } },
    include: ["test/**/*.test.ts"],
  },
});
