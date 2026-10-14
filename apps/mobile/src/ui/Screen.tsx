import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "./Icon";
import { Press } from "./Press";
import { T } from "./Text";
import { c, layout, space } from "./theme";

export function Screen({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View testID={testID} style={[{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }, style]}>
      {children}
    </View>
  );
}

/** Header: optional back key, a title (display face), optional right action. */
export function Header({ title, back, right, large }: { title?: string; back?: boolean; right?: ReactNode; large?: boolean }) {
  return (
    <View style={{ minHeight: layout.topBarHeight + (large ? 8 : 0), flexDirection: "row", alignItems: "center", paddingHorizontal: back ? space[1] : layout.gutter, gap: space[1] }}>
      {back ? (
        <Press onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} accessibilityLabel="Back" testID="header-back" style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
          <Icon name="back" size={24} />
        </Press>
      ) : null}
      <T variant={large ? "display3" : "headline"} numberOfLines={1} style={{ flex: 1 }} accessibilityRole="header">
        {title ?? ""}
      </T>
      {right}
    </View>
  );
}

export function IconButton({ icon, label, onPress, testID }: { icon: Parameters<typeof Icon>[0]["name"]; label: string; onPress: () => void; testID?: string }) {
  return (
    <Press onPress={onPress} accessibilityLabel={label} testID={testID} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
      <Icon name={icon} size={24} />
    </Press>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", paddingHorizontal: layout.gutter, marginTop: space[6], marginBottom: space[3] }}>
      <T variant="monoLabel" color="textDim" style={{ flex: 1 }} accessibilityRole="header">
        {children}
      </T>
      {right}
    </View>
  );
}
