import { Window as HappyWindow } from "happy-dom";
import { vi } from "vitest";
import type { Envelope } from "../src/types.ts";

export type Win = Window & typeof globalThis;

export interface FakeParent {
  postMessage: ReturnType<typeof vi.fn>;
}

/** A fresh happy-dom window acting as the game document. */
export function makeWindow(opts: { rn?: boolean; parent?: FakeParent; url?: string } = {}): Win {
  const win = new HappyWindow({ url: opts.url ?? "http://game.test/index.html", width: 390, height: 754 });
  const w = win as unknown as Record<string, unknown>;
  w.fetch = () => Promise.reject(new Error("offline in tests"));
  if (opts.parent) Object.defineProperty(win, "parent", { value: opts.parent, configurable: true });
  if (opts.rn) w.ReactNativeWebView = { postMessage: vi.fn() };
  return win as unknown as Win;
}

/** Messages the SDK sent through the RN bridge. */
export function rnSent(win: Win): Envelope[] {
  const rn = (win as unknown as { ReactNativeWebView: { postMessage: ReturnType<typeof vi.fn> } }).ReactNativeWebView;
  return rn.postMessage.mock.calls.map((c) => JSON.parse(c[0] as string) as Envelope);
}

/** Delivers a shell -> game envelope the way the RN shell does (injectJavaScript + MessageEvent). */
export function rnDeliver(win: Win, type: string, payload?: unknown, replyTo?: string, asString = false): void {
  const env: Envelope = { ch: "tc", v: 1, id: `h${Math.random().toString(36).slice(2, 8)}`, type };
  if (payload !== undefined) env.payload = payload;
  if (replyTo) env.replyTo = replyTo;
  win.dispatchEvent(new win.MessageEvent("message", { data: asString ? JSON.stringify(env) : env }));
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

export const CONTEXT = {
  sdkVersion: "1.0.0",
  gameId: "duskrail",
  versionId: "11111111-1111-4111-8111-111111111111",
  player: { id: "p_opaque_123", name: "Ines", avatarUrl: null, guest: false },
  locale: "en-US",
  reducedMotion: false,
  audio: { muted: true },
  insets: {
    preview: { top: 91, right: 72, bottom: 148, left: 0 },
    play: { top: 47, right: 0, bottom: 0, left: 0 },
    current: "preview" as const,
  },
  launchReason: "feed" as const,
  seed: 42,
  dailySeed: 7,
  best: 120,
  host: "ios" as const,
};

/** Answers the pending hello so init() resolves. */
export async function handshake(win: Win, context: object = CONTEXT): Promise<void> {
  await tick();
  const hello = rnSent(win).find((e) => e.type === "hello");
  if (!hello) throw new Error("no hello sent");
  rnDeliver(win, "reply", { ok: true, result: context }, hello.id);
  await tick();
}
