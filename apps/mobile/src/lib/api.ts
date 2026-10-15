import { z } from "zod";
import {
  ChallengeResolveResponseSchema,
  FeedResponseSchema,
  SessionEndResponseSchema,
  SessionProgressResponseSchema,
  SessionStartResponseSchema,
  ShareCreateResponseSchema,
  type ClientEvent,
  type FeedResponse,
  type FeedTab,
  type SessionEndRequest,
  type SessionProgressRequest,
  type SessionStartRequest,
  type ShareCreateRequest,
  type ShareCreateResponse,
} from "@thumbcade/protocol";
import { env } from "./env";
import { accessToken, supabaseUrl } from "./supabase";
import { recoverSession } from "../state/auth";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const functionsBase = `${supabaseUrl}/functions/v1`;

type CallInit = { method?: "GET" | "POST"; query?: Record<string, string | number | undefined | null>; body?: unknown; signal?: AbortSignal };

async function call<S extends z.ZodType>(name: string, schema: S, init: CallInit = {}): Promise<z.infer<S>> {
  try {
    return await callOnce(name, schema, init);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      // The session's user is gone; recover with a fresh session and retry once.
      await recoverSession();
      return callOnce(name, schema, init);
    }
    throw e;
  }
}

async function callOnce<S extends z.ZodType>(name: string, schema: S, init: CallInit): Promise<z.infer<S>> {
  const token = (await accessToken()) ?? env.supabaseAnonKey;
  const qs = Object.entries(init.query ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const res = await fetch(`${functionsBase}/${name}${qs ? `?${qs}` : ""}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.supabaseAnonKey,
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : null),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // fall through
  }
  if (!res.ok) {
    const err = (json ?? {}) as { error?: string; message?: string };
    throw new ApiError(res.status, err.error ?? "http_error", err.message ?? `${name} failed (${res.status})`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ApiError(502, "bad_response", `${name} returned an unexpected payload`);
  return parsed.data;
}

export interface FeedQuery {
  tab: FeedTab;
  cursor?: string | null;
  limit?: number;
  tag?: string | null;
  first?: string | null;
}

export function fetchFeed(q: FeedQuery, signal?: AbortSignal): Promise<FeedResponse> {
  return call("feed", FeedResponseSchema, {
    query: { tab: q.tab, cursor: q.cursor, limit: q.limit ?? 8, tag: q.tag, first: q.first },
    signal,
  });
}

export function postEvents(events: ClientEvent[]) {
  return call("events", z.object({ accepted: z.number() }), { body: { events } });
}

export function sessionStart(req: SessionStartRequest) {
  return call("session-start", SessionStartResponseSchema, { body: req });
}

export function sessionEnd(req: SessionEndRequest) {
  return call("session-end", SessionEndResponseSchema, { body: req });
}

export function sessionProgress(req: SessionProgressRequest) {
  return call("session-progress", SessionProgressResponseSchema, { body: req });
}

export function resolveChallenge(code: string) {
  return call("challenge-resolve", ChallengeResolveResponseSchema, { query: { code } });
}

export function createShare(req: ShareCreateRequest): Promise<ShareCreateResponse> {
  return call("share-create", ShareCreateResponseSchema, { body: req });
}

export function deleteAccount() {
  return call("account-delete", z.object({ deleted: z.literal(true) }), { body: {} });
}

/** Everything stored about the caller (GDPR Art. 15/20); the shape is documented by the function. */
export function exportAccount() {
  return call("account-export", z.record(z.string(), z.unknown()));
}
