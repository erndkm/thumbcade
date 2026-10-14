import { RefreshControl, ScrollView, useWindowDimensions, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { CATEGORIES } from "@thumbcade/protocol";
import { qk } from "../../src/lib/query";
import { supabase } from "../../src/lib/supabase";
import type { GameRow } from "../../src/lib/types";
import { ErrorState } from "../../src/ui/EmptyState";
import { GameIcon } from "../../src/ui/GameIcon";
import { Icon } from "../../src/ui/Icon";
import { PosterTile } from "../../src/ui/PosterTile";
import { Press } from "../../src/ui/Press";
import { Header, Screen, SectionTitle } from "../../src/ui/Screen";
import { Skeleton } from "../../src/ui/Skeleton";
import { T } from "../../src/ui/Text";
import { c, layout, radius, space } from "../../src/ui/theme";

type G = Pick<GameRow, "id" | "slug" | "name" | "icon_url" | "poster_url" | "accent_color" | "play_count" | "tags" | "session_length" | "published_at">;

async function fetchDiscover() {
  const [games, tags, rows] = await Promise.all([
    supabase.from("games").select("id, slug, name, icon_url, poster_url, accent_color, play_count, tags, session_length, published_at").eq("status", "live").order("play_count", { ascending: false }).limit(200),
    supabase.from("hashtags").select("tag, game_count, trend_score").gt("game_count", 0).order("trend_score", { ascending: false }).limit(12),
    supabase.from("editorial_rows").select("id, slug, title, subtitle, game_ids, position").eq("active", true).order("position", { ascending: true }),
  ]);
  if (games.error) throw games.error;
  return {
    games: (games.data ?? []) as G[],
    tags: (tags.data ?? []) as { tag: string; game_count: number; trend_score: number }[],
    rows: (rows.data ?? []) as { id: string; slug: string; title: string; subtitle: string | null; game_ids: string[] }[],
  };
}

export default function Discover() {
  const { width } = useWindowDimensions();
  const q = useQuery({ queryKey: qk.discover, queryFn: fetchDiscover, staleTime: 5 * 60_000 });
  const games = q.data?.games ?? [];
  const byId = new Map(games.map((g) => [g.id, g]));
  const weekAgo = Date.now() - 7 * 864e5;
  const fresh = games.filter((g) => g.published_at && new Date(g.published_at).getTime() > weekAgo).sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
  const quick = games.filter((g) => g.session_length === "short");
  const tileW = Math.round((width - layout.gutter * 2 - space[2] * 2) / 2.6);

  const rows: { key: string; title: string; subtitle?: string | null; games: G[] }[] = [
    ...(q.data?.rows ?? []).map((r) => ({ key: r.id, title: r.title, subtitle: r.subtitle, games: r.game_ids.map((id) => byId.get(id)).filter((g): g is G => !!g) })),
    { key: "new", title: "New this week", subtitle: "Fresh off the review queue", games: fresh },
    { key: "quick", title: "Under a minute", subtitle: "Runs that fit between two stops", games: quick },
  ].filter((r) => r.games.length > 0);

  return (
    <Screen testID="discover">
      <Header title="Discover" large />
      <ScrollView refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={c.textDim} />} contentContainerStyle={{ paddingBottom: space[16] }}>
        <Press onPress={() => router.push("/search")} testID="discover-search" accessibilityLabel="Search games, creators and hashtags" scaleTo={0.98} style={{ marginHorizontal: layout.gutter, height: 48, borderRadius: radius.input, backgroundColor: c.raised, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3] }}>
          <Icon name="search" size={18} color={c.textDim} />
          <T variant="body" color="textDim">
            Games, creators, #hashtags
          </T>
        </Press>
        {q.isPending ? (
          <DiscoverSkeleton />
        ) : q.isError ? (
          <ErrorState what="Discover" onRetry={() => void q.refetch()} />
        ) : (
          <>
            {q.data.tags.length ? (
              <>
                <SectionTitle>Trending</SectionTitle>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2], paddingHorizontal: layout.gutter }}>
                  {q.data.tags.map((t, i) => (
                    <Press key={t.tag} onPress={() => router.push(`/tag/${t.tag}`)} accessibilityLabel={`Trending number ${i + 1}, #${t.tag}`} testID={`trend-${t.tag}`} scaleTo={0.95} style={{ flexDirection: "row", alignItems: "center", gap: space[2], height: 40, paddingHorizontal: space[3], borderRadius: radius.chip, borderWidth: 1, borderColor: i === 0 ? c.accent : c.line }}>
                      <T variant="mono" color={i === 0 ? "accentText" : "textDim"}>
                        {String(i + 1).padStart(2, "0")}
                      </T>
                      <T variant="mono">#{t.tag}</T>
                    </Press>
                  ))}
                </View>
              </>
            ) : null}

            <SectionTitle>Categories</SectionTitle>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2], paddingHorizontal: layout.gutter }}>
              {CATEGORIES.map((cat) => {
                const inCat = games.filter((g) => g.tags.some((t) => (cat.tags as readonly string[]).includes(t)));
                const w = (width - layout.gutter * 2 - space[2]) / 2;
                return (
                  <Press key={cat.id} onPress={() => router.push({ pathname: "/tag/[tag]", params: { tag: cat.id, cat: "1" } })} testID={`category-${cat.id}`} accessibilityLabel={`${cat.label}, ${inCat.length} games`} scaleTo={0.97} style={{ width: w, height: 104, borderRadius: radius.sheetInner, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, padding: space[3], justifyContent: "space-between", overflow: "hidden" }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <T variant="title">{cat.label}</T>
                      <T variant="mono" color="textDim">
                        {inCat.length}
                      </T>
                    </View>
                    <View style={{ flexDirection: "row" }}>
                      {inCat.slice(0, 4).map((g, i) => (
                        <View key={g.id} style={{ marginLeft: i === 0 ? 0 : -10, borderRadius: 9, borderWidth: 2, borderColor: c.surface }}>
                          <GameIcon url={g.icon_url} size={32} accent={g.accent_color} />
                        </View>
                      ))}
                    </View>
                  </Press>
                );
              })}
            </View>

            {rows.map((row) => (
              <View key={row.key}>
                <SectionTitle>{row.title}</SectionTitle>
                {row.subtitle ? (
                  <T variant="caption" color="textDim" style={{ paddingHorizontal: layout.gutter, marginTop: -space[2], marginBottom: space[3] }}>
                    {row.subtitle}
                  </T>
                ) : null}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: layout.gutter, gap: space[2] }}>
                  {row.games.map((g) => (
                    <PosterTile key={g.id} game={g} width={tileW} onPress={() => router.push({ pathname: "/play", params: { first: g.slug, title: row.title } })} />
                  ))}
                </ScrollView>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function DiscoverSkeleton() {
  return (
    <View style={{ paddingHorizontal: layout.gutter, gap: space[3], marginTop: space[6] }} accessibilityLabel="Loading Discover">
      <Skeleton style={{ width: 90, height: 12 }} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        {[80, 110, 70, 96, 120, 88].map((w, i) => (
          <Skeleton key={i} style={{ width: w, height: 40 }} />
        ))}
      </View>
      <Skeleton style={{ width: 110, height: 12, marginTop: space[4] }} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} style={{ width: "48.5%", height: 104 }} />
        ))}
      </View>
    </View>
  );
}
