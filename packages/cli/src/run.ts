// Development entry (tsx packages/cli/src/run.ts <command>); the published bin imports dist/cli.js.
import { main } from "./cli.ts";

process.exitCode = await main(process.argv.slice(2));
