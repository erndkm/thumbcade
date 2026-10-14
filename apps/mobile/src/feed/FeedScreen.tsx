import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { router, useIsFocused } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaFrame, useSafeAreaInsets } from "react-native-safe-area-context";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { FeedCard, FeedTab, LaunchReason } from "@thumbcade/protocol";
import { shouldShowDockCoach } from "@thumbcade/swipe-contract";
import { durations, layout } from "@thumbcade/design-tokens";
import { fetchFeed } from "../lib/api";
import { haptic } from "../lib/haptics";
import { qk } from "../lib/query";
import { supabase } from "../lib/supabase";
import { useMe, invalidateMe } from "../hooks/useMe";
import { useUnreadCount } from "../hooks/useUnread";
import { useReduceMotion } from "../hooks/useMotion";
import { useAuth } from "../state/auth";
import { useSettings } from "../state/settings";
import { useWebViewOwner, useWarmWebView } from "../state/webviews";
import { requireMember, setLike } from "../features/social";
import { openMoreSheet } from "../features/more/openMoreSheet";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Press } from "../ui/Press";
import { Skeleton } from "../ui/Skeleton";
import { T } from "../ui/Text";
import { accentOf, alpha, c, space } from "../ui/theme";
import { BottomBar, type TabKey } from "./BottomBar";
import type { ChallengeInfo } from "./controller";
import { setFeedLayout } from "./layout";
import { Pager, type PagerApi } from "./Pager";
import { createController } from "./services";

export interface FeedSource {
  tab: FeedTab;
  tag?: string | null;
  /** Slug to put first (deep links, game page "Play"). */
  first?: string | null;
  challenge?: ChallengeInfo | null;
  /** Launch reason for the first card. */
  firstReason?: LaunchReason;
  /** Extra cards to put in front (developer menu LAN games). */
  devCards?: FeedCard[];
}

export interface FeedScreenProps {
  source: FeedSource;
  /** Home: Following | For You tabs. Scoped feeds: a back button and a title. */
  mode: "home" | "scoped";
  title?: string;
  onTabChange?: (tab: FeedTab) => void;
}

function feedKey(s: FeedSource): string {
  return [s.tab, s.tag ?? "", s.first ?? "", s.challenge?.code ?? ""].join("|");
}

export function FeedScreen({ source, mode, title, onTabChange }: FeedScreenProps) {
  const frame = useSafeAreaFrame();
  const insets = useSafeAreaInsets();
  const width = frame.width;
  const cardHeight = Math.round(frame.height - layout.bottomBarHeight - insets.bottom);
  useEffect(() => {
    setFeedLayout({ cardHeight, width, safeTop: insets.top, safeBottom: insets.bottom });
  }, [cardHeight, width, insets.top, insets.bottom]);

  const userId = useAuth((s) => s.userId);
  const key = feedKey(source);
  const query = useInfiniteQuery({
    queryKey: [...qk.feed(source.tab), key, userId],
    enabled: !!userId,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      fetchFeed({ tab: source.tab, cursor: pageParam, tag: source.tag ?? null, first: pageParam ? null : (source.first ?? null) }, signal),
    getNextPageParam: (last) => last.nextCursor,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  });

  const cards = useMemo(() => {
    const seen = new Set<string>();
    const out: FeedCard[] = [...(source.devCards ?? [])];
    for (const page of query.data?.pages ?? []) {
      for (const card of page.cards) {
        if (seen.has(card.cardId)) continue;
        seen.add(card.cardId);
        out.push(card);
      }
    }
    return out;
  }, [query.data, source.devCards]);

  // WebView budget + focus.
  const id = useId();
  const isFocused = useIsFocused();
  const owner = useWebViewOwner((s) => s.owner);
  const claim = useWebViewOwner((s) => s.claim);
  const release = useWebViewOwner((s) => s.release);
  const warmDone = useWarmWebView((s) => s.done);
  useEffect(() => {
    if (isFocused) {
      claim(id);
      warmDone();
    }
  }, [isFocused, claim, id, warmDone]);
  useEffect(() => () => release(id), [release, id]);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setAppActive(s === "active"));
    return () => sub.remove();
  }, []);
  void appActive;

  const firstSlug = source.first ?? null;
  const devIds = useMemo(() => new Set((source.devCards ?? []).map((c) => c.cardId)), [source.devCards]);
  const makeController = useCallback(
    (card: FeedCard) => {
      const isDev = devIds.has(card.cardId);
      const isFirst = !!firstSlug && card.game.slug === firstSlug && card.rank.source === "deeplink";
      return createController(card, {
        launchReason: isDev ? "dev" : isFirst ? (source.challenge ? "challenge" : (source.firstReason ?? "feed")) : "feed",
        challenge: isFirst ? (source.challenge ?? null) : null,
        dev: isDev,
      });
    },
    [devIds, firstSlug, source.challenge, source.firstReason],
  );

  const onNearEnd = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, [query]);

  const reduce = useReduceMotion();
  const me = useMe();
  const isGuest = useAuth((s) => s.isGuest);
  const soundOn = useSettings((s) => s.soundOn);
  const guestCoach = useSettings((s) => s.dockCoachShown);
  const setSettings = useSettings((s) => s.set);
  const unread = useUnreadCount();
  const coachedFor = useRef(new Set<string>());

  const onTab = useCallback(
    (tab: TabKey) => {
      if (tab === "home") {
        if (mode === "scoped") router.navigate("/");
        return;
      }
      router.navigate(tab === "me" ? "/me" : `/${tab}`);
    },
    [mode],
  );

  if (!userId || (query.isPending && cards.length === 0)) {
    return <FeedSkeleton cardHeight={cardHeight} mode={mode} title={title} source={source} onTabChange={onTabChange} />;
  }
  if (cards.length === 0) {
    return (
      <FeedEmpty
        cardHeight={cardHeight}
        mode={mode}
        title={title}
        source={source}
        onTabChange={onTabChange}
        error={query.isError}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const renderTop = (api: PagerApi) => (
    <TopBar mode={mode} title={title} tab={source.tab} onTabChange={onTabChange} hidden={api.phase === "PLAYING"} reduce={reduce} />
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }} testID="feed">
      <Pager
        cards={cards}
        width={width}
        height={cardHeight}
        safeTop={insets.top}
        live={owner === id}
        focused={isFocused && appActive}
        makeController={makeController}
        isDev={(card) => devIds.has(card.cardId)}
        onNearEnd={onNearEnd}
        overlay={renderTop}
        bottomBar={(api) => {
          const card = api.activeCard;
          const playing = api.phase === "PLAYING";
          const timesShown = isGuest ? guestCoach : (me.data?.dock_coach_shown ?? 0);
          const coachKey = card && api.active ? `${card.cardId}:${api.active.getSnapshot().runs}` : "";
          const coach = !!card && playing && shouldShowDockCoach(api.phase, card.game.controls, timesShown) && !coachedFor.current.has(coachKey);
          return (
            <BottomBar
              active="home"
              onTab={onTab}
              mode={playing ? "dock" : "tabbar"}
              accent={card ? accentOf(card.game.accentColor) : c.text}
              gesture={api.dockGesture}
              inboxBadge={unread}
              coach={coach}
              onCoachShown={() => {
                coachedFor.current.add(coachKey);
                haptic.coach();
                if (isGuest) setSettings({ dockCoachShown: guestCoach + 1 });
                else if (userId) {
                  void supabase
                    .from("profiles")
                    .update({ dock_coach_shown: Math.min(32000, (me.data?.dock_coach_shown ?? 0) + 1) })
                    .eq("id", userId)
                    .then(() => invalidateMe());
                }
              }}
              dock={
                card
                  ? {
                      liked: card.viewer.liked,
                      onLike: () => requireMember(`Sign up to like ${card.game.name}.`, () => void setLike(card.game.id, !card.viewer.liked)),
                      muted: !soundOn,
                      onToggleMute: () => setSettings({ soundOn: !soundOn }),
                      onMore: () => openMoreSheet(card),
                    }
                  : undefined
              }
            />
          );
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------------------------

function TopBar({
  mode,
  title,
  tab,
  onTabChange,
  hidden,
  reduce,
}: {
  mode: "home" | "scoped";
  title?: string | undefined;
  tab: FeedTab;
  onTabChange?: ((tab: FeedTab) => void) | undefined;
  hidden: boolean;
  reduce: boolean;
}) {
  const insets = useSafeAreaInsets();
  const o = useSharedValue(hidden ? 0 : 1);
  useEffect(() => {
    o.value = withTiming(hidden ? 0 : 1, { duration: reduce ? durations.fade : durations.overlay });
  }, [hidden, reduce, o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: (o.value - 1) * 10 }] }));
  return (
    <Animated.View pointerEvents={hidden ? "none" : "box-none"} style={[{ position: "absolute", left: 0, right: 0, top: 0 }, style]}>
      <LinearGradient pointerEvents="none" colors={[alpha(c.bg, 0.5), alpha(c.bg, 0)]} style={{ position: "absolute", left: 0, right: 0, top: 0, height: insets.top + layout.topBarHeight + 36 }} />
      <View style={{ marginTop: insets.top, height: layout.topBarHeight, flexDirection: "row", alignItems: "center", paddingHorizontal: space[2] }}>
        {mode === "scoped" ? (
          <>
            <Press onPress={() => router.back()} accessibilityLabel="Back" testID="feed-back" style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
              <Icon name="back" size={24} halo />
            </Press>
            <T variant="headline" numberOfLines={1} style={{ flex: 1, textAlign: "center", textShadowColor: alpha(c.bg, 0.5), textShadowRadius: 6 }}>
              {title ?? ""}
            </T>
            <View style={{ width: 44 }} />
          </>
        ) : (
          <>
            <View style={{ width: 44 }} />
            <View style={{ flex: 1, flexDirection: "row", justifyContent: "center", gap: space[5] }} accessibilityRole="tablist">
              <TopTab label="Following" active={tab === "following"} onPress={() => onTabChange?.("following")} testID="top-following" />
              <TopTab label="For You" active={tab === "foryou"} onPress={() => onTabChange?.("foryou")} testID="top-foryou" />
            </View>
            <Press onPress={() => router.push("/search")} accessibilityLabel="Search" testID="feed-search" style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
              <Icon name="search" size={24} halo />
            </Press>
          </>
        )}
      </View>
    </Animated.View>
  );
}

function TopTab({ label, active, onPress, testID }: { label: string; active: boolean; onPress: () => void; testID: string }) {
  return (
    <Press onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={label} testID={testID} style={{ alignItems: "center", paddingVertical: space[2] }} scaleTo={0.95}>
      <T variant="headline" color={active ? "text" : "textDim"} style={{ textShadowColor: alpha(c.bg, 0.5), textShadowRadius: 6 }}>
        {label}
      </T>
      <View style={{ marginTop: 4, width: 22, height: 3, backgroundColor: active ? c.text : "transparent" }} />
    </Press>
  );
}

function Frame({ cardHeight, mode, title, source, onTabChange, children }: { cardHeight: number; mode: "home" | "scoped"; title?: string | undefined; source: FeedSource; onTabChange?: ((tab: FeedTab) => void) | undefined; children: ReactNode }) {
  const unread = useUnreadCount();
  const reduce = useReduceMotion();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ height: cardHeight }}>
        {children}
        <TopBar mode={mode} title={title} tab={source.tab} onTabChange={onTabChange} hidden={false} reduce={reduce} />
      </View>
      <BottomBar
        active="home"
        mode="tabbar"
        inboxBadge={unread}
        onTab={(tab) => {
          if (tab !== "home") router.navigate(tab === "me" ? "/me" : `/${tab}`);
        }}
      />
    </View>
  );
}

/** Loading: the final layout in skeleton form. Never a spinner in the feed. */
function FeedSkeleton(props: { cardHeight: number; mode: "home" | "scoped"; title?: string | undefined; source: FeedSource; onTabChange?: ((tab: FeedTab) => void) | undefined }) {
  return (
    <Frame {...props}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: c.surface }]} testID="feed-skeleton" accessibilityLabel="Loading the feed">
        <View style={{ position: "absolute", left: layout.gutter, bottom: space[4], gap: space[2], width: 220 }}>
          <Skeleton style={{ width: 110, height: 16 }} />
          <Skeleton style={{ width: 200, height: 26 }} />
          <Skeleton style={{ width: 230, height: 14 }} />
          <Skeleton style={{ width: 170, height: 14 }} />
          <View style={{ flexDirection: "row", gap: space[1.5] }}>
            <Skeleton style={{ width: 64, height: 22 }} />
            <Skeleton style={{ width: 52, height: 22 }} />
          </View>
        </View>
        <View style={{ position: "absolute", right: 14, bottom: space[4], gap: space[5], alignItems: "center" }}>
          <Skeleton style={{ width: 44, height: 44, borderRadius: 12 }} />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} style={{ width: 32, height: 32 }} />
          ))}
          <Skeleton round style={{ width: 52, height: 52 }} />
        </View>
      </View>
    </Frame>
  );
}

function FeedEmpty(props: {
  cardHeight: number;
  mode: "home" | "scoped";
  title?: string | undefined;
  source: FeedSource;
  onTabChange?: ((tab: FeedTab) => void) | undefined;
  error: boolean;
  onRetry: () => void;
}) {
  const following = props.source.tab === "following" && !props.error;
  return (
    <Frame {...props}>
      <View style={[StyleSheet.absoluteFill, { justifyContent: "center", paddingHorizontal: space[8], gap: space[4] }]} testID={props.error ? "feed-error" : "feed-empty"}>
        <Icon name={props.error ? "bolt" : following ? "profile" : "hash"} size={32} color={c.textDim} />
        <T variant="display3">{props.error ? "The feed tripped over a cable." : following ? "Nobody to follow yet." : "Nothing here yet."}</T>
        <T variant="body" color="textDim">
          {props.error
            ? "We couldn't reach the arcade. Check your connection and give it another shot."
            : following
              ? "Follow a creator and their games land here, newest first."
              : "No live games match this yet. New ones drop every week."}
        </T>
        <Button
          label={props.error ? "Retry" : following ? "Find creators" : "Back to For You"}
          onPress={props.error ? props.onRetry : following ? () => router.navigate("/discover") : () => props.onTabChange?.("foryou")}
          style={{ alignSelf: "flex-start" }}
        />
      </View>
    </Frame>
  );
}
