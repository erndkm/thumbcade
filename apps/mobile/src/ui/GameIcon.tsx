import { memo } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { iconRadius } from "@thumbcade/design-tokens";
import { localUrl } from "../lib/env";
import { c } from "./theme";

/** A game's profile picture: continuous-corner squircle. */
export const GameIcon = memo(function GameIcon({ url, size = 44, accent }: { url: string | null | undefined; size?: number; accent?: string }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: iconRadius(size),
        borderCurve: "continuous",
        overflow: "hidden",
        backgroundColor: accent ?? c.raised,
      }}
    >
      {url ? <Image source={{ uri: localUrl(url) }} style={{ width: size, height: size }} contentFit="cover" cachePolicy="memory-disk" /> : null}
    </View>
  );
});
