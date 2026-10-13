"use client";
import {
  BRIDGE_RATE_LIMITS,
  createRateLimiter,
  envelope,
  parseGameMessage,
  REQUEST_TYPES,
  type GameToShellType,
  type LaunchContext,
  type ReplyPayload,
  type ShellToGameType,
} from "@thumbcade/protocol";
import { useCallback, useEffect, useRef, type RefObject } from "react";

export type Reply = (result: ReplyPayload) => void;
export type GameMessageHandler = (type: GameToShellType, payload: unknown, reply: Reply | null) => void;

/**
 * Host side of the iframe transport for one game frame. Strict on everything inbound:
 * the message must come from this iframe's window AND the game's origin, parse against the
 * protocol schemas, and pass the per-type rate limiter. Anything else is dropped.
 */
export function useGameBridge({
  iframe,
  origin,
  getContext,
  onMessage,
}: {
  iframe: RefObject<HTMLIFrameElement | null>;
  origin: string;
  getContext: () => LaunchContext;
  onMessage: GameMessageHandler;
}) {
  const handlerRef = useRef(onMessage);
  const contextRef = useRef(getContext);
  useEffect(() => {
    handlerRef.current = onMessage;
    contextRef.current = getContext;
  });

  const post = useCallback(
    (data: unknown) => {
      const win = iframe.current?.contentWindow;
      if (win) win.postMessage(data, origin);
    },
    [iframe, origin],
  );

  const send = useCallback(
    (type: ShellToGameType, payload?: unknown) => {
      post(envelope(type, payload));
    },
    [post],
  );

  useEffect(() => {
    const allow = createRateLimiter(BRIDGE_RATE_LIMITS);
    const listener = (event: MessageEvent) => {
      const win = iframe.current?.contentWindow;
      if (!win || event.source !== win || event.origin !== origin) return;
      const parsed = parseGameMessage(event.data);
      if (!parsed.ok) return;
      const { envelope: env, payload } = parsed;
      const isRequest = REQUEST_TYPES.has(env.type);
      const reply: Reply | null = isRequest ? (result) => post(envelope("reply", result, env.id)) : null;
      if (!allow(env.type)) {
        reply?.({ ok: false, error: { code: "rate_limited", message: `Too many ${env.type} messages` } });
        return;
      }
      if (env.type === "hello") {
        reply?.({ ok: true, result: contextRef.current() });
        return;
      }
      handlerRef.current(env.type, payload, reply);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [iframe, origin, post]);

  return { send };
}
