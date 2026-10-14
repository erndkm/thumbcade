import { useState } from "react";
import { ScrollView, View } from "react-native";
import { openSheet } from "../../state/sheets";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Icon } from "../../ui/Icon";
import { Press } from "../../ui/Press";
import { SheetDragArea } from "../../ui/Sheet";
import { SheetTitle } from "../../ui/SheetRow";
import { T } from "../../ui/Text";
import { c, layout, space } from "../../ui/theme";
import { report, type ReportReason } from "../social";

const REASONS: { id: ReportReason; label: string; for: ("game" | "comment" | "user")[] }[] = [
  { id: "spam", label: "Spam or scam", for: ["game", "comment", "user"] },
  { id: "harassment", label: "Harassment or bullying", for: ["comment", "user"] },
  { id: "hate", label: "Hate speech", for: ["game", "comment", "user"] },
  { id: "sexual", label: "Sexual content", for: ["game", "comment", "user"] },
  { id: "violence", label: "Violence or threats", for: ["game", "comment", "user"] },
  { id: "self_harm", label: "Self-harm", for: ["game", "comment", "user"] },
  { id: "age_inappropriate", label: "Not right for its age rating", for: ["game"] },
  { id: "broken", label: "Broken or doesn't load", for: ["game"] },
  { id: "ip_violation", label: "Copies someone else's work", for: ["game"] },
  { id: "other", label: "Something else", for: ["game", "comment", "user"] },
];

export function openReportSheet(type: "game" | "comment" | "user", id: string, name: string): void {
  openSheet({ key: "report", snap: 0.8, keyboard: true, accessibilityLabel: "Report", render: (close) => <ReportSheet type={type} id={id} name={name} onDone={close} /> });
}

function ReportSheet({ type, id, name, onDone }: { type: "game" | "comment" | "user"; id: string; name: string; onDone: () => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: space[6] }}>
      <SheetDragArea>
        <SheetTitle>Report {type === "game" ? name : type === "user" ? `@${name}` : "comment"}</SheetTitle>
      </SheetDragArea>
      <T variant="body" color="textDim" style={{ paddingHorizontal: layout.gutter, marginBottom: space[3] }}>
        Reports are private. Our moderators review every one.
      </T>
      {REASONS.filter((r) => r.for.includes(type)).map((r) => (
        <Press key={r.id} onPress={() => setReason(r.id)} scaleTo={0.99} testID={`report-${r.id}`} accessibilityRole="radio" accessibilityState={{ checked: reason === r.id }} style={{ flexDirection: "row", alignItems: "center", minHeight: 48, paddingHorizontal: layout.gutter, gap: space[3] }}>
          <View style={{ width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: reason === r.id ? c.accent : c.lineStrong, backgroundColor: reason === r.id ? c.accent : "transparent", alignItems: "center", justifyContent: "center" }}>
            {reason === r.id ? <Icon name="check" size={14} color={c.onAccent} strokeWidth={2.6} /> : null}
          </View>
          <T variant="body">{r.label}</T>
        </Press>
      ))}
      <View style={{ paddingHorizontal: layout.gutter, gap: space[3], marginTop: space[3] }}>
        <Field label="Details (optional)" value={details} onChangeText={setDetails} multiline maxLength={1000} placeholder="Anything that helps us understand" style={{ minHeight: 80, textAlignVertical: "top" }} />
        <Button
          testID="report-send"
          label="Send report"
          disabled={!reason}
          busy={busy}
          onPress={async () => {
            if (!reason) return;
            setBusy(true);
            const ok = await report(type, id, reason, details.trim() || undefined);
            setBusy(false);
            if (ok) onDone();
          }}
        />
      </View>
    </ScrollView>
  );
}
