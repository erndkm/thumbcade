import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { workspaceGames } from "./plugins/workspace-games.ts";

export default defineConfig({
  base: "./",
  plugins: [react(), workspaceGames()],
  server: { port: 5173, strictPort: true, host: "localhost" },
  build: { outDir: "dist", target: "es2022", sourcemap: true },
});
