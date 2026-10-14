import type { ReactNode } from "react";
import { View } from "react-native";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { T } from "./Text";
import { c, layout, space } from "./theme";

export function EmptyState({ icon, title, body, action, onAction, children, testID }: { icon: IconName; title: string; body: string; action?: string; onAction?: () => void; children?: ReactNode; testID?: string }) {
  return (
    <View testID={testID} style={{ paddingHorizontal: layout.gutter, paddingVertical: space[10], gap: space[3], alignItems: "flex-start" }}>
      <View style={{ width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: c.line, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={24} color={c.textDim} />
      </View>
      <T variant="title">{title}</T>
      <T variant="body" color="textDim">
        {body}
      </T>
      {action && onAction ? <Button label={action} onPress={onAction} small style={{ marginTop: space[2] }} /> : null}
      {children}
    </View>
  );
}

export function ErrorState({ onRetry, what = "This" }: { onRetry: () => void; what?: string }) {
  return <EmptyState icon="bolt" title={`${what} tripped over a cable.`} body="We couldn't reach the arcade. Check your connection and try again." action="Retry" onAction={onRetry} testID="error-state" />;
}
