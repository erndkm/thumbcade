import { styleText } from "node:util";

type Style = Parameters<typeof styleText>[0];
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
export const paint = (style: Style, text: string): string => (tty ? styleText(style, text) : text);

export const ui = {
  title(text: string): void {
    console.log(`\n${paint(["bold"], text)}`);
  },
  info(text: string): void {
    console.log(text);
  },
  dim(text: string): void {
    console.log(paint("gray", text));
  },
  ok(text: string): void {
    console.log(`${paint("green", "✓")} ${text}`);
  },
  warn(text: string): void {
    console.log(`${paint("yellow", "!")} ${text}`);
  },
  fail(text: string): void {
    console.log(`${paint("red", "✗")} ${text}`);
  },
  fix(text: string): void {
    console.log(`    ${paint("gray", "→")} ${paint("gray", text)}`);
  },
  error(text: string): void {
    console.error(`${paint("red", "error")} ${text}`);
  },
  kv(key: string, value: string): void {
    console.log(`  ${paint("gray", key.padEnd(12))} ${value}`);
  },
};

export class CliError extends Error {
  constructor(
    message: string,
    public hint?: string,
    public exitCode = 1,
  ) {
    super(message);
  }
}
