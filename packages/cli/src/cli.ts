import { parseArgs, type ParseArgsConfig } from "node:util";
import { loginCommand, logoutCommand, whoamiCommand } from "./commands/auth.ts";
import { devCommand } from "./commands/dev.ts";
import { publishCommand } from "./commands/publish.ts";
import { validateCommand } from "./commands/validate.ts";
import { CliError, paint, ui } from "./ui.ts";

export const VERSION = "1.0.0";

const HELP = `${paint("bold", "thumbcade")} — build games for the feed

Usage
  thumbcade dev [--port 5173] [--device] [--no-open]   simulator + hot reload; --device serves on your LAN with a QR
  thumbcade validate [--no-build]                      build, then check manifest, budgets and static rules
  thumbcade login [--token tc_…] [--no-open]           device-code login through the portal (or paste a token)
  thumbcade publish [--notes "…"] [--wait]             build → validate → zip → upload for review
  thumbcade whoami                                     who you are, and your games
  thumbcade logout                                     forget the stored token

Environment
  THUMBCADE_PORTAL_URL, THUMBCADE_FUNCTIONS_URL        point at another backend (default: local stack)
  THUMBCADE_TOKEN                                      creator token for CI (skips the keychain)
`;

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const [command, ...rest] = argv;
  const parse = <T extends NonNullable<ParseArgsConfig["options"]>>(options: T) => parseArgs({ args: rest, options, allowPositionals: false, strict: true });
  try {
    switch (command) {
      case "dev": {
        const { values } = parse({ port: { type: "string" }, device: { type: "boolean" }, "no-open": { type: "boolean" } });
        await devCommand({ port: values.port ? Number(values.port) : undefined, device: !!values.device, open: !values["no-open"] });
        return 0;
      }
      case "validate": {
        const { values } = parse({ "no-build": { type: "boolean" } });
        await validateCommand({ noBuild: !!values["no-build"] });
        return 0;
      }
      case "login": {
        const { values } = parse({ token: { type: "string" }, "no-open": { type: "boolean" } });
        await loginCommand({ token: values.token as string | undefined, open: !values["no-open"] });
        return 0;
      }
      case "logout":
        await logoutCommand();
        return 0;
      case "whoami":
        await whoamiCommand();
        return 0;
      case "publish": {
        const { values } = parse({ notes: { type: "string" }, wait: { type: "boolean" }, timeout: { type: "string" } });
        await publishCommand({ notes: values.notes as string | undefined, wait: !!values.wait, timeout: values.timeout ? Number(values.timeout) : undefined });
        return 0;
      }
      case "--version":
      case "-v":
        console.log(VERSION);
        return 0;
      case undefined:
      case "help":
      case "--help":
      case "-h":
        console.log(HELP);
        return 0;
      default:
        ui.error(`Unknown command "${command}".`);
        console.log(HELP);
        return 2;
    }
  } catch (err) {
    if (err instanceof CliError) {
      ui.error(err.message);
      if (err.hint) ui.fix(err.hint);
      return err.exitCode;
    }
    if (err instanceof TypeError && /Unknown option|unexpected argument/i.test(err.message)) {
      ui.error(err.message);
      return 2;
    }
    console.error(err);
    return 1;
  }
}
