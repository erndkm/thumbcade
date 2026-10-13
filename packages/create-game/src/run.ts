// Development entry (tsx packages/create-game/src/run.ts [dir] [flags]); the published bin imports dist/index.js.
import { main } from "./index.ts";

process.exitCode = await main(process.argv.slice(2));
