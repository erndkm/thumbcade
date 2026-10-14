import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import { localUrl } from "../../src/lib/env";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { formatCount, formatRelative, type FeedCard } from "@thumbcade/protocol";
import { iconRadius } from "@thumbcade/design-tokens";
import { useCreatorGames, useGame, useLeaderboard, type GameDetail } from "../../src/hooks/data";
import { useReduceMotion } from "../../src/hooks/useMotion";
import { useAuth } from "../../src/state/auth";
import { useIconTransition } from "../../src/state/transition";
import { requireMember, setFollow, setLike, setSave } from "../../src/features/social";
import { openCommentsFor } from "../../src/features/comments/openComments";
import { openShareSheet } from "../../src/features/share/openShareSheet";
import { openReportSheet } from "../../src/features/report/openReportSheet";
import { fmtScore } from "../../src/lib/format";
import { Avatar } from "../../src/ui/Avatar";
import { Button } from "../../src/ui/Button";
import { ErrorState, EmptyState } from "../../src/ui/EmptyState";
import { GameIcon } from "../../src/ui/GameIcon";
import { Icon } from "../../src/ui/Icon";
import { Press } from "../../src/ui/Press";
import { Header, IconButton, Screen, SectionTitle } from "../../src/ui/Screen";
import { Segmented } from "../../src/ui/Segmented";
import { Skeleton } from "../../src/ui/Skeleton";
import { T } from "../../src/ui/Text";
import { accentOf, c, layout, radius, space, springs } from "../../src/ui/theme";

const HERO = 112;

export default function GamePage() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const q = useGame(slug);
  const game = q.data;
  return (
    <Screen testID="game-page">
      <Header
        back
        right={game ? <IconButton icon="flag" label="Report game" onPress={() => requireMember("Sign up to report games.", () => openReportSheet("game", game.id, game.name))} /> : null}
      />
      {q.isPending ? (
        <GameSkeleton />
      ) : q.isError ? (
        <ErrorState what="This game page" onRetry={() => void q.refetch()} />
      ) : !game ? (
        <EmptyState icon="grid" title="This game left the arcade." body="It was taken down or never existed. Plenty more where that came from." action="Back to the feed" onAction={() => router.replace("/")} />
      ) : (
        <GameBody game={game} />
      )}
      <HeroTransition slug={slug} />
    </Screen>
  );
}

/** Signature moment #2 (second half): the cartridge flies from the rail into the hero slot. */
function HeroTransition({ slug }: { slug: string }) {
  const t = useIconTransition((s) => s.t);
  const clear = useIconTransition((s) => s.set);
  const reduce = useReduceMotion();
  const [target, setTarget] = useState<{ x: number; y: number } | null>(null);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const size = useSharedValue(0);
  const o = useSharedValue(1);
  const active = t && t.slug === slug && Date.now() - t.at < 2000;

  useEffect(() => {
    const sub = heroRect.subscribe((r) => setTarget(r));
    return sub;
  }, []);

  useEffect(() => {
    if (!active || !t) return;
    x.value = t.x + 4;
    y.value = t.y + 4;
    size.value = t.size - 8;
  }, [active, t, x, y, size]);

  useEffect(() => {
    if (!active || !target) return;
    const done = () => {
      heroVisible.set(true);
      clear(null);
    };
    if (reduce) {
      o.value = withTiming(0, { duration: 120 }, () => scheduleOnRN(done));
      return;
    }
    x.value = withSpring(target.x, springs.morph);
    y.value = withSpring(target.y, springs.morph);
    size.value = withSpring(HERO, springs.morph, (f) => {
      if (f) scheduleOnRN(done);
    });
  }, [active, target, reduce, x, y, size, o, clear]);

  useEffect(() => {
    if (!active) heroVisible.set(true);
  }, [active]);

  const style = useAnimatedStyle(() => ({
    position: "absolute",
    left: x.value,
    top: y.value,
    width: size.value,
    height: size.value,
    opacity: o.value,
    borderRadius: size.value * 0.2292,
    overflow: "hidden",
  }));
  if (!active || !t) return null;
  return (
    <Animated.View pointerEvents="none" style={style}>
      <GameIconFill url={t.iconUrl} accent={t.accent} />
    </Animated.View>
  );
}

function GameIconFill({ url, accent }: { url: string | null; accent: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: accent }}>
      {url ? <Image source={{ uri: localUrl(url) }} style={{ width: "100%", height: "100%" }} contentFit="cover" cachePolicy="memory-disk" /> : null}
    </View>
  );
}

// Tiny signals between the hero slot and the transition overlay.
const heroRect = (() => {
  let rect: { x: number; y: number } | null = null;
  const subs = new Set<(r: { x: number; y: number } | null) => void>();
  return {
    set(r: { x: number; y: number }) {
      rect = r;
      subs.forEach((s) => s(r));
    },
    subscribe(fn: (r: { x: number; y: number } | null) => void) {
      subs.add(fn);
      fn(rect);
      return () => {
        subs.delete(fn);
        rect = null;
      };
    },
  };
})();
const heroVisible = (() => {
  let v = true;
  const subs = new Set<(v: boolean) => void>();
  return {
    set(next: boolean) {
      v = next;
      subs.forEach((s) => s(v));
    },
    get: () => v,
    subscribe(fn: (v: boolean) => void) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
})();

function GameBody({ game }: { game: GameDetail }) {
  const accent = accentOf(game.accent_color);
  const userId = useAuth((s) => s.userId);
  const t = useIconTransition((s) => s.t);
  const flying = !!t && t.slug === game.slug && Date.now() - t.at < 2000;
  const [visible, setVisible] = useState(!flying);
  const heroRef = useRef<View>(null);
  useEffect(() => {
    heroVisible.set(!flying);
    const off = heroVisible.subscribe(setVisible);
    return () => {
      off();
    };
  }, [flying]);
  const [scope, setScope] = useState<"daily" | "allTime" | "friends">("daily");
  const board = useLeaderboard(game.id, scope);
  const more = useCreatorGames(game.creator.id);
  const isMine = userId === game.creator.id;
  const card = toFeedCard(game);

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: space[16] }}>
      <View style={{ paddingHorizontal: layout.gutter, flexDirection: "row", gap: space[4], alignItems: "flex-end" }}>
        <View
          ref={heroRef}
          onLayout={() =>
            heroRef.current?.measureInWindow((x, y) => {
              heroRect.set({ x, y });
            })
          }
          style={{ width: HERO, height: HERO, opacity: visible ? 1 : 0 }}
        >
          <GameIcon url={game.icon_url} size={HERO} accent={game.accent_color} />
        </View>
        <View style={{ flex: 1, gap: space[1], paddingBottom: space[1] }}>
          <T variant="display3" numberOfLines={2} testID="game-name">
            {game.name}
          </T>
          <Press onPress={() => router.push(`/u/${game.creator.handle}`)} scaleTo={0.98} style={{ flexDirection: "row", alignItems: "center", gap: space[2], alignSelf: "flex-start" }} accessibilityLabel={`By @${game.creator.handle}`}>
            <Avatar seed={game.creator.avatar_seed} url={game.creator.avatar_url} size={20} />
            <T variant="caption" color="textDim">
              @{game.creator.handle}
            </T>
          </Press>
        </View>
      </View>

      <View style={{ flexDirection: "row", paddingHorizontal: layout.gutter, marginTop: space[5], gap: space[6] }}>
        <Stat value={formatCount(game.play_count)} label="Plays" />
        <Stat value={formatCount(game.like_count)} label="Likes" />
        <Stat value={formatCount(game.comment_count)} label="Comments" />
        {game.best !== null ? <Stat value={fmtScore(game.best, game.score_config)} label="Your best" accent /> : null}
      </View>

      <View style={{ paddingHorizontal: layout.gutter, marginTop: space[5], gap: space[2] }}>
        <Button testID="game-play" label="Play" icon="play" kind="accent" fill={accent} fillText={accent === c.text ? c.bg : undefined} onPress={() => router.push({ pathname: "/play", params: { first: game.slug, reason: "gamePage", title: game.name } })} />
        <View style={{ flexDirection: "row", gap: space[2] }}>
          <SmallAction icon="like" active={game.liked} activeColor={c.heat} label={game.liked ? "Liked" : "Like"} onPress={() => requireMember(`Sign up to like ${game.name}.`, () => void setLike(game.id, !game.liked))} />
          <SmallAction icon="save" active={game.saved} activeColor={c.accent} label={game.saved ? "Saved" : "Save"} onPress={() => requireMember(`Sign up to save ${game.name}.`, () => void setSave(game.id, !game.saved))} />
          <SmallAction icon="comment" label="Comments" onPress={() => openCommentsFor({ gameId: game.id, gameName: game.name, creatorId: game.creator_id, accent: game.accent_color, scoreConfig: card.game.score, count: game.comment_count })} />
          <SmallAction icon="share" label="Share" onPress={() => void openShareSheet(card, game.best)} />
        </View>
      </View>

      <SectionTitle>About</SectionTitle>
      <View style={{ paddingHorizontal: layout.gutter, gap: space[3] }}>
        <T variant="body">{game.description}</T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1.5] }}>
          {game.tags.map((tag) => (
            <Press key={tag} onPress={() => router.push(`/tag/${tag}`)} scaleTo={0.95} accessibilityLabel={`Hashtag ${tag}`} style={{ borderWidth: 1, borderColor: c.line, borderRadius: radius.chip, paddingHorizontal: space[2], height: 32, justifyContent: "center" }}>
              <T variant="mono" color={accent}>
                #{tag}
              </T>
            </Press>
          ))}
          <View style={{ borderWidth: 1, borderColor: c.line, borderRadius: radius.chip, paddingHorizontal: space[2], height: 32, justifyContent: "center" }}>
            <T variant="mono" color="textDim">
              {game.age_rating} · {game.controls.vertical ? "Swipe controls" : "Tap controls"}
            </T>
          </View>
        </View>
      </View>

      <SectionTitle>Leaderboard</SectionTitle>
      <Segmented
        items={[
          { key: "daily", label: "Today" },
          { key: "allTime", label: "All-time" },
          { key: "friends", label: "Friends" },
        ]}
        value={scope}
        onChange={setScope}
        testIDPrefix="board"
      />
      <View style={{ paddingTop: space[2] }}>
        {board.isPending ? (
          <View style={{ paddingHorizontal: layout.gutter, gap: space[3], paddingTop: space[2] }}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} style={{ height: 28 }} />
            ))}
          </View>
        ) : board.isError ? (
          <ErrorState what="The leaderboard" onRetry={() => void board.refetch()} />
        ) : (board.data ?? []).length === 0 ? (
          <T variant="body" color="textDim" style={{ paddingHorizontal: layout.gutter, paddingVertical: space[4] }}>
            {scope === "friends" ? "No friends on this board yet. Friends are people you follow who follow you back." : scope === "daily" ? "Nobody has played today. First run takes the crown." : "No scores yet. Be the first name up there."}
          </T>
        ) : (
          (board.data ?? []).map((r) => (
            <Press key={`${r.user_id}`} onPress={() => router.push(`/u/${r.handle}`)} scaleTo={0.99} accessibilityLabel={`Rank ${r.rank}, @${r.handle}, ${fmtScore(r.score, game.score_config)}`} style={{ flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: layout.gutter, minHeight: 48, backgroundColor: r.is_me ? c.surface : "transparent" }}>
              <T variant="mono" color={r.rank <= 3 ? "text" : "textDim"} style={{ width: 28 }}>
                {String(r.rank).padStart(2, "0")}
              </T>
              <Avatar seed={r.avatar_seed} url={r.avatar_url} size={28} />
              <T variant="body" numberOfLines={1} style={{ flex: 1 }}>
                @{r.handle}
              </T>
              <T variant="mono" color={r.is_me ? "accentText" : "text"}>
                {fmtScore(r.score, game.score_config)}
              </T>
            </Press>
          ))
        )}
      </View>

      {game.version ? (
        <>
          <SectionTitle>What's new · v{game.version.semver}</SectionTitle>
          <View style={{ paddingHorizontal: layout.gutter, gap: space[1] }}>
            <T variant="body" color={game.version.release_notes ? "text" : "textDim"}>
              {game.version.release_notes ?? "First release. Everything is new."}
            </T>
            <T variant="mono" color="textDim">
              Live {formatRelative(game.version.created_at)} ago
            </T>
          </View>
        </>
      ) : null}

      {(more.data ?? []).filter((g) => g.id !== game.id).length ? (
        <>
          <SectionTitle>More from @{game.creator.handle}</SectionTitle>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: layout.gutter, gap: space[3] }}>
            {(more.data ?? [])
              .filter((g) => g.id !== game.id)
              .map((g) => (
                <Press key={g.id} onPress={() => router.push(`/game/${g.slug}`)} scaleTo={0.96} accessibilityLabel={g.name} style={{ width: 84, gap: space[1.5] }}>
                  <GameIcon url={g.icon_url} size={84} accent={g.accent_color} />
                  <T variant="caption" numberOfLines={1}>
                    {g.name}
                  </T>
                </Press>
              ))}
          </ScrollView>
        </>
      ) : null}

      {!isMine ? (
        <View style={{ paddingHorizontal: layout.gutter, marginTop: space[8] }}>
          <Button
            label={game.following ? `Following @${game.creator.handle}` : `Follow @${game.creator.handle}`}
            kind={game.following ? "ghost" : "secondary"}
            icon={game.following ? "check" : "plus"}
            onPress={() => requireMember(`Sign up to follow @${game.creator.handle}.`, () => void setFollow(game.creator.id, !game.following, game.id))}
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

function Stat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <View>
      <T variant="headline" color={accent ? "accentText" : "text"}>
        {value}
      </T>
      <T variant="monoLabel" color="textDim">
        {label}
      </T>
    </View>
  );
}

function SmallAction({ icon, label, onPress, active, activeColor }: { icon: "like" | "save" | "comment" | "share"; label: string; onPress: () => void; active?: boolean; activeColor?: string }) {
  return (
    <Press onPress={onPress} accessibilityLabel={label} accessibilityState={{ selected: !!active }} scaleTo={0.95} style={{ flex: 1, height: 56, borderRadius: radius.sheetInner, borderWidth: 1, borderColor: c.line, alignItems: "center", justifyContent: "center", gap: 2 }}>
      <Icon name={icon} size={20} active={active} color={active && activeColor ? activeColor : c.text} />
      <T variant="micro" color="textDim">
        {label}
      </T>
    </Press>
  );
}

function GameSkeleton() {
  return (
    <View style={{ paddingHorizontal: layout.gutter, gap: space[4] }} accessibilityLabel="Loading game">
      <View style={{ flexDirection: "row", gap: space[4], alignItems: "flex-end" }}>
        <Skeleton style={{ width: HERO, height: HERO, borderRadius: iconRadius(HERO) }} />
        <View style={{ flex: 1, gap: space[2] }}>
          <Skeleton style={{ width: "80%", height: 28 }} />
          <Skeleton style={{ width: "50%", height: 14 }} />
        </View>
      </View>
      <Skeleton style={{ height: 52 }} />
      <Skeleton style={{ height: 56 }} />
      <Skeleton style={{ height: 80 }} />
    </View>
  );
}

/** The game page reuses the share sheet, which speaks FeedCard. */
function toFeedCard(g: GameDetail): FeedCard {
  return {
    cardId: `page:${g.id}`,
    game: {
      id: g.id,
      slug: g.slug,
      name: g.name,
      description: g.description,
      iconUrl: g.icon_url,
      posterUrl: g.poster_url,
      accentColor: g.accent_color,
      tags: g.tags,
      ageRating: g.age_rating as FeedCard["game"]["ageRating"],
      controls: { vertical: g.controls.vertical, horizontal: g.controls.horizontal ?? false, multitouch: g.controls.multitouch ?? false, inputs: (g.controls.inputs ?? ["tap"]) as FeedCard["game"]["controls"]["inputs"] },
      session: g.session_length,
      audio: true,
      score: { order: g.score_config.order ?? "desc", max: g.score_config.max, format: g.score_config.format ?? "integer", ...(g.score_config.unit ? { unit: g.score_config.unit } : null) },
      stats: { plays: g.play_count, likes: g.like_count, comments: g.comment_count, shares: g.share_count, saves: g.save_count },
    },
    version: { id: g.live_version_id ?? g.id, semver: g.version?.semver ?? "1.0.0", entryUrl: "https://thumbcade.gg/", origin: "https://thumbcade.gg", sdkMajor: 1 },
    creator: { id: g.creator.id, handle: g.creator.handle, displayName: g.creator.display_name, avatarUrl: g.creator.avatar_url, avatarSeed: g.creator.avatar_seed, verified: g.creator.verified },
    viewer: { liked: g.liked, saved: g.saved, followingCreator: g.following, best: g.best },
    topScore: null,
    rank: { source: "editorial" },
  };
}
