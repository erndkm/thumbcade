import { View } from "react-native";
import { Press } from "./Press";
import { T } from "./Text";
import { c, layout, space } from "./theme";

/** Text tabs with a hard underline, not pills. */
export function Segmented<K extends string>({ items, value, onChange, testIDPrefix }: { items: { key: K; label: string }[]; value: K; onChange: (k: K) => void; testIDPrefix?: string }) {
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: c.line, paddingHorizontal: layout.gutter, gap: space[5] }}>
      {items.map((it) => {
        const on = it.key === value;
        return (
          <Press
            key={it.key}
            onPress={() => onChange(it.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={it.label}
            testID={testIDPrefix ? `${testIDPrefix}-${it.key}` : undefined}
            scaleTo={0.96}
            style={{ paddingTop: space[3], minHeight: 44, justifyContent: "flex-end" }}
          >
            <T variant="bodyStrong" color={on ? "text" : "textDim"} style={{ paddingBottom: space[2] }}>
              {it.label}
            </T>
            <View style={{ height: 2, backgroundColor: on ? c.text : "transparent", marginBottom: -1 }} />
          </Press>
        );
      })}
    </View>
  );
}
