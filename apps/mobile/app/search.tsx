import { useEffect, useRef, useState } from "react";
import { FlatList, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { formatCount } from "@thumbcade/protocol";
import { kv } from "../src/lib/kv";
import { supabase } from "../src/lib/supabase";
import type { GameRow, ProfileRow } from "../src/lib/types";
import { Avatar } from "../src/ui/Avatar";
import { EmptyState } from "../src/ui/EmptyState";
import { GameIcon } from "../src/ui/GameIcon";
import { Icon } from "../src/ui/Icon";
import { Press } from "../src/ui/Press";
import { Screen, SectionTitle } from "../src/ui/Screen";
import { Skeleton } from "../src/ui/Skeleton";
import { T } from "../src/ui/Text";
import { c, layout, radius, space, type } from "../src/ui/theme";

type Row =
  | { k: "section"; title: string }
  | { k: "game"; g: Pick<GameRow, "id" | "slug" | "name" | "icon_url" | "accent_color" | "play_count" | "tags"> }
  | { k: "creator"; p: Pick<ProfileRow, "id" | "handle" | "display_name" | "avatar_url" | "avatar_seed" | "follower_count" | "verified"> }
  | { k: "tag"; tag: string; count: number };

const RECENT = "tc.search.recent";

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export default function Search() {
  const [text, setText] = useState("");
  const [recent, setRecent] = useState<string[]>(() => kv.getJSON(RECENT, []));
  const input = useRef<TextInput>(null);
  const q = useDebounced(text.trim().replace(/^[#@]/, "").toLowerCase(), 220);
  const results = useQuery({
    queryKey: ["search", q],
    enabled: q.length >= 1,
    queryFn: async (): Promise<Row[]> => {
      const like = `%${q.replace(/[%_]/g, "")}%`;
      const [games, people, tags] = await Promise.all([
        supabase.from("games").select("id, slug, name, icon_url, accent_color, play_count, tags").eq("status", "live").or(`name.ilike.${like},slug.ilike.${like}`).order("play_count", { ascending: false }).limit(8),
        supabase.from("profiles").select("id, handle, display_name, avatar_url, avatar_seed, follower_count, verified").eq("is_guest", false).or(`handle.ilike.${like},display_name.ilike.${like}`).order("follower_count", { ascending: false }).limit(8),
        supabase.from("hashtags").select("tag, game_count").ilike("tag", like).gt("game_count", 0).order("trend_score", { ascending: false }).limit(8),
      ]);
      const rows: Row[] = [];
      if (games.data?.length) rows.push({ k: "section", title: "Games" }, ...games.data.map((g) => ({ k: "game" as const, g: g as Extract<Row, { k: "game" }>["g"] })));
      if (people.data?.length) rows.push({ k: "section", title: "Creators & players" }, ...people.data.map((p) => ({ k: "creator" as const, p: p as Extract<Row, { k: "creator" }>["p"] })));
      if (tags.data?.length) rows.push({ k: "section", title: "Hashtags" }, ...tags.data.map((t: { tag: string; game_count: number }) => ({ k: "tag" as const, tag: t.tag, count: t.game_count })));
      return rows;
    },
  });
  const remember = (term: string) => {
    const next = [term, ...recent.filter((r) => r !== term)].slice(0, 8);
    setRecent(next);
    kv.setJSON(RECENT, next);
  };
  return (
    <Screen testID="search">
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[2], paddingVertical: space[2] }}>
        <Press onPress={() => router.back()} accessibilityLabel="Back" style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
          <Icon name="back" size={24} />
        </Press>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space[2], backgroundColor: c.raised, borderRadius: radius.input, paddingHorizontal: space[3], height: 44 }}>
          <Icon name="search" size={18} color={c.textDim} />
          <TextInput
            ref={input}
            testID="search-input"
            autoFocus
            value={text}
            onChangeText={setText}
            placeholder="Games, creators, #hashtags"
            placeholderTextColor={c.textMute}
            selectionColor={c.accent}
            keyboardAppearance="dark"
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={() => text.trim() && remember(text.trim())}
            style={[type("body"), { flex: 1, color: c.text }]}
            accessibilityLabel="Search"
          />
          {text ? (
            <Press onPress={() => setText("")} accessibilityLabel="Clear" hitSlop={10}>
              <Icon name="close" size={16} color={c.textDim} />
            </Press>
          ) : null}
        </View>
      </View>
      {q.length === 0 ? (
        recent.length ? (
          <View>
            <SectionTitle
              right={
                <Press
                  onPress={() => {
                    setRecent([]);
                    kv.setJSON(RECENT, []);
                  }}
                  accessibilityLabel="Clear recent searches"
                >
                  <T variant="monoLabel" color="textDim">
                    Clear
                  </T>
                </Press>
              }
            >
              Recent
            </SectionTitle>
            {recent.map((r) => (
              <Press key={r} onPress={() => setText(r)} accessibilityLabel={`Search ${r}`} style={{ flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: layout.gutter, minHeight: 44 }}>
                <Icon name="replay" size={16} color={c.textMute} />
                <T variant="body">{r}</T>
              </Press>
            ))}
          </View>
        ) : (
          <EmptyState icon="search" title="Find your next obsession." body="Search game names, creators or hashtags like #onetap and #puzzle." />
        )
      ) : results.isPending ? (
        <View style={{ padding: layout.gutter, gap: space[3] }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={{ flexDirection: "row", gap: space[3], alignItems: "center" }}>
              <Skeleton style={{ width: 44, height: 44, borderRadius: 10 }} />
              <Skeleton style={{ flex: 1, height: 16 }} />
            </View>
          ))}
        </View>
      ) : (results.data ?? []).length === 0 ? (
        <EmptyState icon="search" title={`Nothing for "${text.trim()}".`} body="Try a shorter word, a creator's handle, or a hashtag." />
      ) : (
        <FlatList
          data={results.data}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(r, i) => `${r.k}-${i}`}
          contentContainerStyle={{ paddingBottom: space[16] }}
          renderItem={({ item }) => {
            if (item.k === "section") return <SectionTitle>{item.title}</SectionTitle>;
            if (item.k === "game")
              return (
                <ResultRow onPress={() => (remember(text.trim()), router.push(`/game/${item.g.slug}`))} label={item.g.name}>
                  <GameIcon url={item.g.icon_url} size={44} accent={item.g.accent_color} />
                  <View style={{ flex: 1 }}>
                    <T variant="bodyStrong">{item.g.name}</T>
                    <T variant="mono" color="textDim">
                      {formatCount(item.g.play_count)} plays · {item.g.tags.slice(0, 2).map((t) => `#${t}`).join(" ")}
                    </T>
                  </View>
                </ResultRow>
              );
            if (item.k === "creator")
              return (
                <ResultRow onPress={() => (remember(text.trim()), router.push(`/u/${item.p.handle}`))} label={`@${item.p.handle}`}>
                  <Avatar seed={item.p.avatar_seed} url={item.p.avatar_url} size={44} />
                  <View style={{ flex: 1 }}>
                    <T variant="bodyStrong">{item.p.display_name}</T>
                    <T variant="mono" color="textDim">
                      @{item.p.handle} · {formatCount(item.p.follower_count)} followers
                    </T>
                  </View>
                </ResultRow>
              );
            return (
              <ResultRow onPress={() => (remember(text.trim()), router.push(`/tag/${item.tag}`))} label={`#${item.tag}`}>
                <View style={{ width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: c.line, alignItems: "center", justifyContent: "center" }}>
                  <Icon name="hash" size={20} />
                </View>
                <View style={{ flex: 1 }}>
                  <T variant="bodyStrong">#{item.tag}</T>
                  <T variant="mono" color="textDim">
                    {item.count} {item.count === 1 ? "game" : "games"}
                  </T>
                </View>
              </ResultRow>
            );
          }}
        />
      )}
    </Screen>
  );
}

function ResultRow({ children, onPress, label }: { children: React.ReactNode; onPress: () => void; label: string }) {
  return (
    <Press onPress={onPress} accessibilityLabel={label} scaleTo={0.99} style={{ flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: layout.gutter, paddingVertical: space[2] }}>
      {children}
    </Press>
  );
}
