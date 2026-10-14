import { memo } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { formatCount } from "@thumbcade/protocol";
import { localUrl } from "../lib/env";
import { Icon } from "./Icon";
import { Press } from "./Press";
import { T } from "./Text";
import { alpha, c, radius, space } from "./theme";

export interface PosterTileGame {
  id: string;
  slug: string;
  name: string;
  poster_url: string | null;
  accent_color: string;
  play_count: number;
}

/** A 9:16 poster tile with the play count, like a short-video grid cell. */
export const PosterTile = memo(function PosterTile({ game, width, onPress, label }: { game: PosterTileGame; width: number; onPress: () => void; label?: string }) {
  const height = Math.round((width * 16) / 9);
  return (
    <Press onPress={onPress} scaleTo={0.97} accessibilityLabel={`${game.name}, ${formatCount(game.play_count)} plays`} testID={`tile-${game.slug}`} style={{ width, height, borderRadius: radius.chip, overflow: "hidden", backgroundColor: alpha(game.accent_color, 0.2) }}>
      {game.poster_url ? <Image source={{ uri: localUrl(game.poster_url) }} style={{ width, height }} contentFit="cover" cachePolicy="memory-disk" transition={120} /> : null}
      <LinearGradient colors={[alpha(c.bg, 0), alpha(c.bg, 0.7)]} style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: height * 0.4 }} />
      <View style={{ position: "absolute", left: space[2], right: space[2], bottom: space[2], gap: 2 }}>
        {label ? (
          <T variant="monoLabel" color={c.accent} numberOfLines={1}>
            {label}
          </T>
        ) : null}
        <T variant="caption" numberOfLines={1} style={{ fontWeight: undefined }}>
          {game.name}
        </T>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          <Icon name="play" size={10} active color={c.text} />
          <T variant="mono" style={{ fontSize: 11, lineHeight: 13 }}>
            {formatCount(game.play_count)}
          </T>
        </View>
      </View>
    </Press>
  );
});

/** Three-up grid of poster tiles. */
export function PosterGrid({ games, width, onPress, labelFor }: { games: PosterTileGame[]; width: number; onPress: (g: PosterTileGame, index: number) => void; labelFor?: (g: PosterTileGame) => string | undefined }) {
  const gap = 3;
  const tile = Math.floor((width - gap * 2) / 3);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap }}>
      {games.map((g, i) => (
        <PosterTile key={`${g.id}-${i}`} game={g} width={tile} onPress={() => onPress(g, i)} label={labelFor?.(g)} />
      ))}
    </View>
  );
}

export function PosterGridSkeleton({ width, count = 6 }: { width: number; count?: number }) {
  const gap = 3;
  const tile = Math.floor((width - gap * 2) / 3);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap }} accessibilityLabel="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={{ width: tile, height: Math.round((tile * 16) / 9), borderRadius: radius.chip, backgroundColor: c.surface }} />
      ))}
    </View>
  );
}
