import { memo, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { formatCount, formatScore, type FeedCard } from "@thumbcade/protocol";
import { Icon } from "../ui/Icon";
import { Press } from "../ui/Press";
import { T } from "../ui/Text";
import { accentOf, alpha, c, layout, space } from "../ui/theme";

/** The caption should fit the fixed preview inset reported to games, so it scales less with Dynamic Type. */
const CAPTION_SCALE = 1.12;

const INPUT_LABEL: Record<string, string> = {
  tap: "Tap",
  swipe: "Swipe",
  drag: "Drag",
  longpress: "Long-press",
  hold: "Hold",
  joystick: "Stick",
  tilt: "Tilt",
};

/** Bottom-left caption: @creator, game name, expandable description, #hashtags, meta line. */
export const Caption = memo(function Caption({ card, width }: { card: FeedCard; width: number }) {
  const [open, setOpen] = useState(false);
  const { fontScale } = useWindowDimensions();
  const { game, creator, topScore } = card;
  const accent = accentOf(game.accentColor);
  const shadow = { textShadowColor: alpha(c.bg, 0.55), textShadowRadius: 6 } as const;
  const inputs = game.controls.inputs.map((i) => INPUT_LABEL[i] ?? i).slice(0, 2);
  return (
    // Bottom-anchored with its natural height, so it grows upward and never loses the meta line.
    // Tighter rows once Dynamic Type is up keep it within (or a few points over) the preview inset.
    <View style={{ width, gap: fontScale > 1 ? 2 : space[1] }} testID="caption">
      <Press onPress={() => router.push(`/u/${creator.handle}`)} scaleTo={0.98} hitSlop={6} accessibilityLabel={`@${creator.handle}`} style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: space[1] }}>
        <T maxFontSizeMultiplier={CAPTION_SCALE} variant="bodyStrong" style={shadow}>
          @{creator.handle}
        </T>
        {creator.verified ? (
          <View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: c.text, alignItems: "center", justifyContent: "center" }} accessibilityLabel="Verified">
            <Icon name="check" size={11} color={c.bg} strokeWidth={3} />
          </View>
        ) : null}
      </Press>
      <T maxFontSizeMultiplier={CAPTION_SCALE} variant="title" numberOfLines={1} style={shadow} testID="caption-name">
        {game.name}
      </T>
      <Press onPress={() => setOpen((o) => !o)} scaleTo={1} hitSlop={4} accessibilityLabel={game.description} accessibilityHint={open ? "Collapse" : "Expand"}>
        <T maxFontSizeMultiplier={CAPTION_SCALE} variant="body" numberOfLines={open ? 4 : 1} style={shadow}>
          {game.description}
        </T>
      </Press>
      <View style={{ flexDirection: "row", flexWrap: "nowrap", gap: space[1.5], overflow: "hidden", marginTop: 2 }}>
        {game.tags.map((tag) => (
          <Press
            key={tag}
            onPress={() => router.push(`/tag/${tag}`)}
            scaleTo={0.95}
            hitSlop={6}
            accessibilityLabel={`Hashtag ${tag}`}
            style={{ paddingHorizontal: space[1.5], paddingVertical: 2, borderRadius: 6, backgroundColor: alpha(c.bg, 0.38), borderWidth: 1, borderColor: accent }}
          >
            <T maxFontSizeMultiplier={CAPTION_SCALE} variant="mono" color={accent}>
              #{tag}
            </T>
          </Press>
        ))}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5], marginTop: 2 }}>
        <Icon name="play" size={12} color={c.textDim} active />
        <T maxFontSizeMultiplier={CAPTION_SCALE} variant="mono" color="textDim" style={shadow} numberOfLines={1}>
          {formatCount(game.stats.plays)} plays
          {topScore !== null ? ` · best ${formatScore(topScore, game.score)}` : ""}
          {inputs.length ? ` · ${inputs.join("/")}` : ""}
        </T>
      </View>
    </View>
  );
});

export const CAPTION_RESERVED = layout.captionHeight;
