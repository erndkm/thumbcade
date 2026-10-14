import { memo, useMemo } from "react";
import { View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { Image } from "expo-image";
import { pixelAvatar } from "@thumbcade/design-tokens";
import { localUrl } from "../lib/env";
import { c } from "./theme";

export interface AvatarProps {
  seed: string;
  url?: string | null;
  size?: number;
  /** Square (sprite) or rounded. Pixel sprites are square with a soft corner. */
  ring?: string;
}

/** Generative 8x8 pixel sprite (never initials) or the uploaded photo. */
export const Avatar = memo(function Avatar({ seed, url, size = 40, ring }: AvatarProps) {
  const sprite = useMemo(() => pixelAvatar(seed), [seed]);
  const r = Math.round(size * 0.28);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: r,
        overflow: "hidden",
        backgroundColor: sprite.background,
        borderWidth: ring ? 2 : 0,
        borderColor: ring,
      }}
    >
      {url ? (
        <Image source={{ uri: localUrl(url) }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
      ) : (
        <Svg width="100%" height="100%" viewBox="0 0 8 8">
          <Rect width={8} height={8} fill={sprite.background} />
          {sprite.cells.map((on, i) =>
            on ? <Rect key={i} x={i % 8} y={Math.floor(i / 8)} width={1.02} height={1.02} fill={sprite.foreground} /> : null,
          )}
        </Svg>
      )}
      {!url ? null : <View style={{ position: "absolute", inset: 0, borderRadius: r, borderWidth: 1, borderColor: c.line }} />}
    </View>
  );
});
