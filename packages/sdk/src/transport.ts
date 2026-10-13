import { CHANNEL, PROTOCOL_VERSION } from "./constants.ts";
import type { Envelope } from "./types.ts";

export type TransportKind = "rn" | "iframe" | "standalone";

export interface Transport {
  kind: TransportKind;
  send(env: Envelope): void;
  close(): void;
}

export type Receive = (env: Envelope) => void;

interface RnWindow extends Window {
  ReactNativeWebView?: { postMessage(data: string): void };
}

/** Hand-written envelope guard (the SDK never ships zod). Accepts an object or a JSON string. */
export function toEnvelope(data: unknown): Envelope | null {
  let d = data;
  if (typeof d === "string") {
    if (d.length > 65_536 || d.charCodeAt(0) !== 123 /* { */) return null;
    try {
      d = JSON.parse(d);
    } catch {
      return null;
    }
  }
  if (!d || typeof d !== "object") return null;
  const e = d as Record<string, unknown>;
  return e.ch === CHANNEL &&
    e.v === PROTOCOL_VERSION &&
    typeof e.id === "string" &&
    typeof e.type === "string" &&
    (e.replyTo === undefined || typeof e.replyTo === "string")
    ? (e as unknown as Envelope)
    : null;
}

/** Picks the transport for the current page. `?tc_host=rn|iframe|standalone` forces one (debugging). */
export function detectKind(win: Window): TransportKind {
  const forced = /[?&]tc_host=(rn|iframe|standalone)\b/.exec(win.location?.search ?? "");
  if (forced) return forced[1] as TransportKind;
  if ((win as RnWindow).ReactNativeWebView?.postMessage) return "rn";
  try {
    if (win.parent && win.parent !== win) return "iframe";
  } catch {
    return "iframe";
  }
  return "standalone";
}

/**
 * React Native WebView: out via `window.ReactNativeWebView.postMessage(JSON.stringify(env))`; in via a
 * `MessageEvent` the shell dispatches with `injectJavaScript` (data = envelope object or JSON string).
 * Android's WebView historically dispatched on `document`, so both are observed.
 */
export function rnTransport(win: Window, receive: Receive): Transport {
  const onMessage = (e: Event) => {
    const env = toEnvelope((e as MessageEvent).data);
    if (env) receive(env);
  };
  win.addEventListener("message", onMessage);
  win.document.addEventListener("message", onMessage);
  return {
    kind: "rn",
    send: (env) => (win as RnWindow).ReactNativeWebView?.postMessage(JSON.stringify(env)),
    close() {
      win.removeEventListener("message", onMessage);
      win.document.removeEventListener("message", onMessage);
    },
  };
}

/**
 * Iframe (simulator, web player, reviewer): out via `parent.postMessage(env, "*")` (the payloads carry
 * nothing secret; the host checks `event.origin`); in, only messages whose source is the parent window.
 */
export function iframeTransport(win: Window, receive: Receive): Transport {
  const onMessage = (e: MessageEvent) => {
    if (e.source !== win.parent) return;
    const env = toEnvelope(e.data);
    if (env) receive(env);
  };
  win.addEventListener("message", onMessage);
  return {
    kind: "iframe",
    send: (env) => win.parent.postMessage(env, "*"),
    close: () => win.removeEventListener("message", onMessage),
  };
}
