import { Linking, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { formatLegalDate, LEGAL_DOCS, splitLinks, type LegalBlock, type LegalDocId } from "@thumbcade/legal";
import { Header, Screen } from "../../src/ui/Screen";
import { T } from "../../src/ui/Text";
import { c, layout, space } from "../../src/ui/theme";

/** Imprint, Privacy Policy, Terms and Community guidelines; the text is shared with the portal (@thumbcade/legal). */
export default function Legal() {
  const { doc } = useLocalSearchParams<{ doc?: string }>();
  const d = LEGAL_DOCS[(doc as LegalDocId | undefined) ?? "terms"] ?? LEGAL_DOCS.terms;
  return (
    <Screen testID={`legal-${doc ?? "terms"}`}>
      <Header back title={d.title} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: space[16], gap: space[5] }}>
        <T variant="mono" color="textDim">
          Last updated {formatLegalDate(d.updated)}
        </T>
        {d.intro ? <Linked text={d.intro} /> : null}
        {d.sections.map((s) => (
          <View key={s.heading} style={{ gap: space[2] }}>
            <T variant="headline" accessibilityRole="header">
              {s.heading}
            </T>
            {s.blocks.map((b, i) => (
              <Block key={i} block={b} />
            ))}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

function Block({ block }: { block: LegalBlock }) {
  if (block.kind === "p") return <Linked text={block.text} />;
  if (block.kind === "list")
    return (
      <View style={{ gap: space[2] }}>
        {block.items.map((item) => (
          <View key={item} style={{ flexDirection: "row", gap: space[3] }}>
            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: c.textDim, marginTop: 8 }} />
            <View style={{ flex: 1 }}>
              <Linked text={item} />
            </View>
          </View>
        ))}
      </View>
    );
  return (
    <View style={{ gap: space[3], paddingLeft: space[3], borderLeftWidth: 2, borderLeftColor: c.line }}>
      {block.items.map((f) => (
        <View key={f.label} style={{ gap: space[1] }}>
          <T variant="monoLabel" color="textDim">
            {f.label}
          </T>
          <Linked text={f.text} />
        </View>
      ))}
    </View>
  );
}

function Linked({ text }: { text: string }) {
  return (
    <T variant="body" color="textDim">
      {splitLinks(text).map((seg, i) =>
        seg.href ? (
          <T key={i} variant="body" color="text" accessibilityRole="link" style={{ textDecorationLine: "underline" }} onPress={() => void Linking.openURL(seg.href!)}>
            {seg.text}
          </T>
        ) : (
          seg.text
        ),
      )}
    </T>
  );
}
