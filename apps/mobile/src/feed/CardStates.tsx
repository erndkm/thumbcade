import { View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Press } from "../ui/Press";
import { T } from "../ui/Text";
import { c, radius, space } from "../ui/theme";

export function PausePill({ onResume, reason }: { onResume: () => void; reason?: string }) {
  return (
    <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)}>
      <Press
        testID="resume-pill"
        onPress={onResume}
        accessibilityLabel="Resume game"
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space[3],
          paddingLeft: space[3],
          paddingRight: space[5],
          height: 52,
          borderRadius: radius.pill,
          backgroundColor: c.surface,
          borderWidth: 1,
          borderColor: c.lineStrong,
        }}
      >
        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c.text, alignItems: "center", justifyContent: "center" }}>
          <Icon name="play" size={16} color={c.bg} active />
        </View>
        <View>
          <T variant="bodyStrong">Paused</T>
          <T variant="monoLabel" color="textDim">
            {reason ?? "Tap to resume"}
          </T>
        </View>
      </Press>
    </Animated.View>
  );
}

export function FailedState({ onRetry }: { onRetry: () => void }) {
  return (
    <Animated.View
      entering={FadeIn.duration(160)}
      testID="card-failed"
      style={{ marginHorizontal: space[8], padding: space[5], gap: space[3], borderRadius: radius.sheet, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}
    >
      <T variant="headline">That game tripped over a cable.</T>
      <T variant="body" color="textDim">
        It didn't load in time. Give it another go, or swipe on.
      </T>
      <Button label="Retry" icon="replay" onPress={onRetry} testID="card-retry" />
    </Animated.View>
  );
}

export function DevBadge({ onPress }: { onPress: () => void }) {
  return (
    <Press onPress={onPress} accessibilityLabel="Developer card, show bridge log" style={{ paddingHorizontal: space[2], paddingVertical: 4, borderRadius: 4, backgroundColor: c.warning }}>
      <T variant="monoLabel" color={c.bg}>
        Dev
      </T>
    </Press>
  );
}
