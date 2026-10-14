import { RefreshControl, ScrollView, useWindowDimensions, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { CATEGORIES, formatCount } from "@thumbcade/protocol";
import { qk } from "../../src/lib/query";
import { supabase } from "../../src/lib/supabase";
import type { GameRow } from "../../src/lib/types";
import { EmptyState, ErrorState } from "../../src/ui/EmptyState";
import { PosterGrid, PosterGridSkeleton } from "../../src/ui/PosterTile";
import { Header, Screen } from "../../src/ui/Screen";
import { T } from "../../src/ui/Text";
import { c, layout, space } from "../../src/ui/theme";

const TILE = "id, slug, name, poster_url, accent_color, play_count, like_count, tags";

/** Hashtag page (and category page): a poster grid; tapping a tile opens the feed scoped to it. */
export default function TagPage() {
  const { tag, cat } = useLocalSearchParams<{ tag: string; cat?: string }>();
  const { width } = useWindowDimensions();
  const category = cat ? CATEGORIES.find((x) => x.id === tag) : undefined;
  const q = useQuery({
    queryKey: [...qk.tag(tag), cat ?? ""],
    queryFn: async () => {
      let query = supabase.from("games").select(TILE).eq("status", "live");
      query = category ? query.overlaps("tags", [...category.tags]) : query.contains("tags", [tag]);
      const [games, meta] = await Promise.all([
        query.order("play_count", { ascending: false }).limit(90),
        category ? Promise.resolve({ data: null }) : supabase.from("hashtags").select("tag, game_count, trend_score").eq("tag", tag).maybeSingle(),
      ]);
      if (games.error) throw games.error;
      return { games: (games.data ?? []) as (GameRow & { like_count: number })[], meta: meta.data as { game_count: number; trend_score: number } | null };
    },
  });
  const games = q.data?.games ?? [];
  const plays = games.reduce((a, g) => a + g.play_count, 0);
  return (
    <Screen testID="tag-page">
      <Header back />
      <ScrollView refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={c.textDim} />} contentContainerStyle={{ paddingBottom: space[16] }}>
        <View style={{ paddingHorizontal: layout.gutter, paddingBottom: space[5], gap: space[1] }}>
          <T variant="display2" numberOfLines={2}>
            {category ? category.label : `#${tag}`}
          </T>
          <T variant="mono" color="textDim">
            {q.isPending ? " " : `${games.length} ${games.length === 1 ? "game" : "games"} · ${formatCount(plays)} plays${q.data?.meta && q.data.meta.trend_score > 0.5 ? " · trending" : ""}`}
          </T>
        </View>
        {q.isPending ? (
          <PosterGridSkeleton width={width} count={9} />
        ) : q.isError ? (
          <ErrorState what="This hashtag" onRetry={() => void q.refetch()} />
        ) : games.length === 0 ? (
          <EmptyState icon="hash" title="No games wear this tag yet." body="Tags fill up as creators publish. Try a trending one in Discover." action="Open Discover" onAction={() => router.navigate("/discover")} />
        ) : (
          <PosterGrid
            games={games}
            width={width}
            onPress={(g) =>
              router.push({ pathname: "/play", params: category ? { first: g.slug, title: category.label } : { tag, first: g.slug, title: `#${tag}` } })
            }
          />
        )}
      </ScrollView>
    </Screen>
  );
}
