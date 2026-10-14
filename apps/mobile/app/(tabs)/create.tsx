import { RefreshControl, ScrollView, View } from "react-native";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useQuery } from "@tanstack/react-query";
import { formatCount, formatRelative } from "@thumbcade/protocol";
import { env } from "../../src/lib/env";
import { qk } from "../../src/lib/query";
import { supabase } from "../../src/lib/supabase";
import type { GameRow } from "../../src/lib/types";
import { useMe, invalidateMe } from "../../src/hooks/useMe";
import { useAuth } from "../../src/state/auth";
import { toast } from "../../src/state/toast";
import { requireMember } from "../../src/features/social";
import { Button } from "../../src/ui/Button";
import { ErrorState } from "../../src/ui/EmptyState";
import { GameIcon } from "../../src/ui/GameIcon";
import { Icon, type IconName } from "../../src/ui/Icon";
import { Press } from "../../src/ui/Press";
import { Header, Screen, SectionTitle } from "../../src/ui/Screen";
import { Skeleton } from "../../src/ui/Skeleton";
import { T } from "../../src/ui/Text";
import { c, layout, radius, space } from "../../src/ui/theme";

/** Creator Hub: pitches building a game to players; shows games, review status and today's stats to creators. */
export default function Create() {
  const me = useMe();
  const role = me.data?.role;
  const isCreator = role === "creator" || role === "admin";
  return (
    <Screen testID="create">
      <Header title={isCreator ? "Creator Hub" : "Create"} large />
      {me.isPending ? (
        <View style={{ paddingHorizontal: layout.gutter, gap: space[3] }}>
          <Skeleton style={{ height: 160 }} />
          <Skeleton style={{ height: 60 }} />
        </View>
      ) : isCreator ? (
        <CreatorHub />
      ) : (
        <Pitch />
      )}
    </Screen>
  );
}

const open = (url: string) => void WebBrowser.openBrowserAsync(url, { controlsColor: c.accent, toolbarColor: c.bg, dismissButtonStyle: "close" });

function Pitch() {
  const become = () =>
    requireMember("Sign up first. Creators publish under their handle.", async () => {
      const { error } = await supabase.rpc("become_creator");
      if (error) {
        toast("Couldn't switch you to a creator account. Try again.", "bad");
        return;
      }
      await invalidateMe();
      toast("You're a creator now. Time to ship.", "good");
    });
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: space[16], gap: space[5] }}>
      <View style={{ gap: space[3], paddingTop: space[2] }}>
        <T variant="display2">Your game in this feed by Friday.</T>
        <T variant="body" color="textDim">
          Build with any web tech: Canvas, Phaser, PixiJS, Three.js. Test it in a simulator that behaves exactly like this phone. Publish with one command. No app update, no store review on your side.
        </T>
      </View>
      <View style={{ borderWidth: 1, borderColor: c.line, borderRadius: radius.sheetInner, backgroundColor: c.surface, padding: space[4], gap: space[3] }}>
        <T variant="monoLabel" color="textDim">
          Three commands
        </T>
        {["npm create thumbcade-game", "thumbcade dev", "thumbcade publish"].map((cmd, i) => (
          <View key={cmd} style={{ flexDirection: "row", gap: space[3], alignItems: "center" }}>
            <T variant="mono" color="textDim">
              {String(i + 1).padStart(2, "0")}
            </T>
            <T variant="mono" color={i === 2 ? "accentText" : "text"}>
              $ {cmd}
            </T>
          </View>
        ))}
      </View>
      <Step icon="code" title="Build" body="Start from a template with a complete sample game. Attract mode, tap to start, scores, best score." />
      <Step icon="eye" title="Test like it's live" body="The simulator runs the real feed chrome, the Dock and the Swipe Contract, and flags violations as you play." />
      <Step icon="bolt" title="Ship" body="Automated review checks load time, frame rate and the contract. A human signs off, and you're in the feed." />
      <View style={{ gap: space[2], marginTop: space[2] }}>
        <Button label="Read the docs" icon="code" onPress={() => open(env.docsUrl)} />
        <Button label="Open the creator portal" kind="secondary" onPress={() => open(env.portalUrl)} />
        <Button testID="become-creator" label="Make this a creator account" kind="ghost" onPress={become} />
      </View>
    </ScrollView>
  );
}

function Step({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <View style={{ flexDirection: "row", gap: space[4] }}>
      <View style={{ width: 40, height: 40, borderRadius: 10, borderWidth: 1, borderColor: c.line, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={20} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="headline">{title}</T>
        <T variant="body" color="textDim">
          {body}
        </T>
      </View>
    </View>
  );
}

type HubGame = Pick<GameRow, "id" | "slug" | "name" | "icon_url" | "accent_color" | "status" | "play_count" | "like_count"> & {
  versions: { semver: string; status: string; created_at: string }[];
  stats: { day: string; impressions: number; play_starts: number; likes: number; shares: number }[];
};

const STATUS_COPY: Record<string, { label: string; tone: "good" | "wait" | "bad" | "mute" }> = {
  approved: { label: "Live", tone: "good" },
  pending_review: { label: "In review", tone: "wait" },
  auto_checking: { label: "Auto-checking", tone: "wait" },
  uploaded: { label: "Uploaded", tone: "wait" },
  auto_failed: { label: "Failed checks", tone: "bad" },
  rejected: { label: "Changes needed", tone: "bad" },
};

function CreatorHub() {
  const userId = useAuth((s) => s.userId);
  const today = new Date().toISOString().slice(0, 10);
  const q = useQuery({
    queryKey: [...qk.creatorHub, userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("games")
        .select("id, slug, name, icon_url, accent_color, status, play_count, like_count, versions:game_versions(semver, status, created_at), stats:game_stats_daily(day, impressions, play_starts, likes, shares)")
        .eq("creator_id", userId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as HubGame[];
    },
  });
  const games = q.data ?? [];
  const todays = games.flatMap((g) => g.stats.filter((s) => s.day === today));
  const sum = (k: "impressions" | "play_starts" | "likes" | "shares") => todays.reduce((a, s) => a + s[k], 0);
  return (
    <ScrollView refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={c.textDim} />} contentContainerStyle={{ paddingBottom: space[16] }}>
      <View style={{ flexDirection: "row", marginHorizontal: layout.gutter, borderWidth: 1, borderColor: c.line, borderRadius: radius.sheetInner, backgroundColor: c.surface }}>
        {[
          { k: "impressions" as const, label: "Seen" },
          { k: "play_starts" as const, label: "Plays" },
          { k: "likes" as const, label: "Likes" },
          { k: "shares" as const, label: "Shares" },
        ].map((s, i) => (
          <View key={s.k} style={{ flex: 1, padding: space[3], borderLeftWidth: i ? 1 : 0, borderLeftColor: c.line, gap: 2 }}>
            <T variant="headline">{formatCount(sum(s.k))}</T>
            <T variant="monoLabel" color="textDim">
              {s.label}
            </T>
          </View>
        ))}
      </View>
      <T variant="mono" color="textDim" style={{ paddingHorizontal: layout.gutter, marginTop: space[2] }}>
        Today, all games · updates every 10 minutes
      </T>
      <SectionTitle>Your games</SectionTitle>
      {q.isPending ? (
        <View style={{ paddingHorizontal: layout.gutter, gap: space[3] }}>
          <Skeleton style={{ height: 64 }} />
          <Skeleton style={{ height: 64 }} />
        </View>
      ) : q.isError ? (
        <ErrorState what="Your games" onRetry={() => void q.refetch()} />
      ) : games.length === 0 ? (
        <View style={{ paddingHorizontal: layout.gutter, gap: space[3] }}>
          <T variant="body" color="textDim">
            Nothing published yet. Run `thumbcade publish` from your project and it shows up here with its review status.
          </T>
          <Button label="Read the quickstart" small onPress={() => open(`${env.docsUrl}/quickstart`)} style={{ alignSelf: "flex-start" }} />
        </View>
      ) : (
        games.map((g) => {
          const latest = [...g.versions].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
          const st = latest ? (STATUS_COPY[latest.status] ?? { label: latest.status, tone: "mute" as const }) : { label: "Draft", tone: "mute" as const };
          const tone = st.tone === "good" ? c.accent : st.tone === "bad" ? c.heat : st.tone === "wait" ? c.warning : c.textDim;
          const t = g.stats.find((s) => s.day === today);
          return (
            <Press key={g.id} onPress={() => (g.status === "live" ? router.push(`/game/${g.slug}`) : open(`${env.portalUrl}/dashboard`))} scaleTo={0.99} accessibilityLabel={`${g.name}, ${st.label}`} style={{ flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: layout.gutter, paddingVertical: space[2] }}>
              <GameIcon url={g.icon_url} size={52} accent={g.accent_color} />
              <View style={{ flex: 1, gap: 2 }}>
                <T variant="bodyStrong">{g.name}</T>
                <T variant="mono" color="textDim">
                  {latest ? `v${latest.semver} · ${formatRelative(latest.created_at)}` : "No versions yet"} · {formatCount(t?.play_starts ?? 0)} plays today
                </T>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5] }}>
                <View style={{ width: 6, height: 6, backgroundColor: tone }} />
                <T variant="monoLabel" color={tone}>
                  {st.label}
                </T>
              </View>
            </Press>
          );
        })
      )}
      <View style={{ paddingHorizontal: layout.gutter, marginTop: space[6], gap: space[2] }}>
        <Button label="Open the creator dashboard" kind="secondary" onPress={() => open(`${env.portalUrl}/dashboard`)} />
        <Button label="Docs" kind="ghost" icon="code" onPress={() => open(env.docsUrl)} />
      </View>
    </ScrollView>
  );
}
