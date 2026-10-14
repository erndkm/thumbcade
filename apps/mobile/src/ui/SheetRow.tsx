import type { ReactNode } from "react";
import { View } from "react-native";
import { Icon, type IconName } from "./Icon";
import { Press } from "./Press";
import { T } from "./Text";
import { c, layout, space } from "./theme";
import { closeSheet } from "../state/sheets";

export function SheetRow({ icon, label, hint, onPress, danger, testID, right }: { icon: IconName; label: string; hint?: string; onPress: () => void; danger?: boolean; testID?: string; right?: ReactNode }) {
  return (
    <Press onPress={onPress} testID={testID} accessibilityLabel={label} scaleTo={0.98} style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: space[4], paddingHorizontal: layout.gutter }}>
      <Icon name={icon} size={22} color={danger ? c.heat : c.text} />
      <View style={{ flex: 1 }}>
        <T variant="bodyStrong" color={danger ? "heat" : "text"}>
          {label}
        </T>
        {hint ? (
          <T variant="caption" color="textDim">
            {hint}
          </T>
        ) : null}
      </View>
      {right ?? <Icon name="forward" size={18} color={c.textMute} />}
    </Press>
  );
}

/** Sheet header: title plus a close key (sheets are also dismissed by dragging or tapping the scrim). */
export function SheetTitle({ children, right, onClose }: { children: ReactNode; right?: ReactNode; onClose?: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: layout.gutter, paddingRight: space[2], paddingBottom: space[2], gap: space[2] }}>
      <T variant="title" style={{ flex: 1 }} accessibilityRole="header">
        {children}
      </T>
      {right}
      <Press onPress={onClose ?? (() => closeSheet())} accessibilityLabel="Close" testID="sheet-close" style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
        <Icon name="close" size={20} />
      </Press>
    </View>
  );
}
