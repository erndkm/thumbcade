import "server-only";
import {
  CreatorOverviewSchema,
  GameAnalyticsSchema,
  GameFunnelSchema,
  VersionCompareSchema,
  type AnalyticsRange,
  type CreatorOverview,
  type GameAnalytics,
  type GameFunnel,
  type VersionCompare,
} from "@thumbcade/protocol";
import { createClient } from "@/lib/supabase/server";

/**
 * Creator analytics reads. Every number comes from the owner-checked `creator_*` RPCs
 * (supabase/migrations/*_creator_analytics.sql) and is validated against the protocol schemas, so a
 * drifting SQL shape fails loudly here instead of rendering wrong numbers.
 */

async function rpc<T>(name: string, args: Record<string, unknown>, parse: (v: unknown) => T): Promise<T> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw new Error(`${name}: ${error.message}`);
  return parse(data);
}

export function getCreatorOverview(): Promise<CreatorOverview> {
  return rpc("creator_overview", {}, (v) => CreatorOverviewSchema.parse(v));
}

export function getGameAnalytics(gameId: string, range: AnalyticsRange): Promise<GameAnalytics> {
  return rpc("creator_game_summary", { p_game: gameId, p_range: range }, (v) => GameAnalyticsSchema.parse(v));
}

export function getGameFunnel(gameId: string, range: AnalyticsRange): Promise<GameFunnel> {
  return rpc("creator_game_funnel", { p_game: gameId, p_range: range }, (v) => GameFunnelSchema.parse(v));
}

export function getVersionCompare(gameId: string): Promise<VersionCompare> {
  return rpc("creator_version_compare", { p_game: gameId }, (v) => VersionCompareSchema.parse(v));
}
