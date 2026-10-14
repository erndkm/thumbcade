import { memo, useEffect, useRef } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { formatCount, type FeedCard } from "@thumbcade/protocol";
import { Avatar } from "../ui/Avatar";
import { GameIcon } from "../ui/GameIcon";
import { Icon, type IconName } from "../ui/Icon";
import { Press } from "../ui/Press";
import { T } from "../ui/Text";
import { accentOf, alpha, c, layout, space, springs } from "../ui/theme";
import { useReduceMotion } from "../hooks/useMotion";
import { useIconTransition } from "../state/transition";
import { requireMember, setFollow, setLike, setSave } from "../features/social";
import { openComments } from "../features/comments/openComments";
import { openShareSheet } from "../features/share/openShareSheet";
import { useAuth } from "../state/auth";
import { track } from "../lib/events";
import { LikeBurst, type LikeBurstHandle } from "./LikeBurst";

export interface ActionRailProps {
  card: FeedCard;
  /** The card is the active, visible card (cartridge spins only then). */
  active: boolean;
  lastScore: number | null;
}

export const ActionRail = memo(function ActionRail({ card, active, lastScore }: ActionRailProps) {
  const { game, creator, viewer } = card;
  const accent = accentOf(game.accentColor);
  const burst = useRef<LikeBurstHandle>(null);
  const myId = useAuth((s) => s.userId);
  const isMine = myId === creator.id;

  const like = () =>
    requireMember(`Sign up to like ${game.name}.`, () => {
      const next = !viewer.liked;
      if (next) burst.current?.fire();
      void setLike(game.id, next);
    });
  const save = () => requireMember(`Sign up to save ${game.name} for later.`, () => void setSave(game.id, !viewer.saved));
  const follow = () => requireMember(`Sign up to follow @${creator.handle}.`, () => void setFollow(creator.id, true, game.id));

  return (
    <View style={{ width: layout.actionRailWidth, alignItems: "center", gap: space[4] }} testID="action-rail">
      <View style={{ alignItems: "center", marginBottom: space[1] }}>
        <Press
          onPress={() => router.push(`/u/${creator.handle}`)}
          accessibilityLabel={`@${creator.handle}, open profile`}
          scaleTo={0.92}
        >
          <Avatar seed={creator.avatarSeed} url={creator.avatarUrl} size={layout.avatar.md + 4} ring={c.text} />
        </Press>
        {!viewer.followingCreator && !isMine ? (
          <Press
            onPress={follow}
            accessibilityLabel={`Follow @${creator.handle}`}
            testID="rail-follow"
            hitSlop={12}
            style={{
              position: "absolute",
              bottom: -9,
              width: 20,
              height: 20,
              borderRadius: 6,
              backgroundColor: c.accent,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="plus" size={14} color={c.onAccent} strokeWidth={2.4} />
          </Press>
        ) : null}
      </View>
      <View>
        <RailButton
          icon="like"
          active={viewer.liked}
          activeColor={c.heat}
          label={formatCount(game.stats.likes)}
          a11y={viewer.liked ? `Unlike ${game.name}, ${game.stats.likes} likes` : `Like ${game.name}, ${game.stats.likes} likes`}
          onPress={like}
          testID="rail-like"
          pop
        />
        <View pointerEvents="none" style={{ position: "absolute", left: 24, top: 16 }}>
          <LikeBurst ref={burst} accent={accent} />
        </View>
      </View>
      <RailButton
        icon="comment"
        label={formatCount(game.stats.comments)}
        a11y={`Comments, ${game.stats.comments}`}
        onPress={() => openComments(card)}
        testID="rail-comment"
      />
      <RailButton
        icon="save"
        active={viewer.saved}
        activeColor={c.accent}
        label={formatCount(game.stats.saves)}
        a11y={viewer.saved ? "Remove from saved" : "Save"}
        onPress={save}
        testID="rail-save"
        pop
      />
      <RailButton
        icon="share"
        label={formatCount(game.stats.shares)}
        a11y="Share"
        onPress={() => openShareSheet(card, lastScore)}
        testID="rail-share"
      />
      <Cartridge card={card} spinning={active} />
    </View>
  );
});

function RailButton({
  icon,
  label,
  onPress,
  active,
  activeColor,
  a11y,
  testID,
  pop,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  activeColor?: string;
  a11y: string;
  testID?: string;
  pop?: boolean;
}) {
  const s = useSharedValue(1);
  const reduce = useReduceMotion();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!pop || reduce || !active) return;
    s.value = withSequence(withTiming(0.72, { duration: 70 }), withSpring(1, springs.pop));
  }, [active, pop, reduce, s]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Press onPress={onPress} accessibilityLabel={a11y} accessibilityState={{ selected: !!active }} testID={testID} style={{ alignItems: "center", minWidth: layout.hitTarget }} scaleTo={0.88}>
      <Animated.View style={style}>
        <Icon name={icon} size={32} active={active} color={active && activeColor ? activeColor : c.text} halo />
      </Animated.View>
      <T variant="mono" style={{ marginTop: 2, textShadowColor: alpha(c.bg, 0.5), textShadowRadius: 4 }}>
        {label}
      </T>
    </Press>
  );
}

/** Signature moment #2: the game's icon spinning slowly like a record; opens the game page. */
function Cartridge({ card, spinning }: { card: FeedCard; spinning: boolean }) {
  const rot = useSharedValue(0);
  const reduce = useReduceMotion();
  const ref = useRef<View>(null);
  const setT = useIconTransition((s) => s.set);
  const accent = accentOf(card.game.accentColor);
  useEffect(() => {
    if (!spinning || reduce) {
      cancelAnimation(rot);
      return;
    }
    rot.value = withRepeat(withTiming(rot.value + 360, { duration: 7000, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(rot);
  }, [spinning, reduce, rot]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value % 360}deg` }] }));
  const open = () => {
    track({ type: "open_game_page", gameId: card.game.id });
    ref.current?.measureInWindow((x, y, w) => {
      setT({ slug: card.game.slug, x, y, size: w, iconUrl: card.game.iconUrl, accent, at: Date.now() });
      router.push(`/game/${card.game.slug}`);
    });
  };
  const size = layout.cartridgeSize;
  return (
    <Press onPress={open} accessibilityLabel={`Open ${card.game.name}'s game page`} testID="rail-cartridge" style={{ marginTop: space[1] }}>
      <Animated.View
        ref={ref}
        style={[
          {
            width: size + 8,
            height: size + 8,
            borderRadius: (size + 8) / 2,
            backgroundColor: c.raised,
            borderWidth: 2,
            borderColor: accent,
            alignItems: "center",
            justifyContent: "center",
          },
          style,
        ]}
      >
        <GameIcon url={card.game.iconUrl} size={size - 6} accent={card.game.accentColor} />
      </Animated.View>
    </Press>
  );
}
