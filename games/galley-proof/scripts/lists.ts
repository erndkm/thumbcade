/** The shipped word lists, read from disk (for the headless pilot, the tests and the shoot plan). */
import { readFileSync } from "node:fs";
import { PackedWords, parseAnswers } from "../src/lexicon.ts";
import type { Lists } from "../src/pilot.ts";

export function loadLists(): Lists & { accept: PackedWords } {
  const answers = parseAnswers(readFileSync(new URL("../src/data/answers.txt", import.meta.url), "utf8"));
  const accept = new PackedWords(readFileSync(new URL("../src/data/accept.txt", import.meta.url), "utf8"));
  return { answers, accept, isWord: (w) => accept.has(w) };
}
