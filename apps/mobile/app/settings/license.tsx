import { useMemo } from "react";
import { Linking, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { FALLBACK_NOTE, noticeMeta, noticeParagraphs, notices } from "../../src/features/licenses/notices";
import { EmptyState } from "../../src/ui/EmptyState";
import { Header, Screen } from "../../src/ui/Screen";
import { T } from "../../src/ui/Text";
import { c, layout, space } from "../../src/ui/theme";

/** One package's licence and notice texts, as the package ships them (see /settings/licenses). */
export default function License() {
  const { i } = useLocalSearchParams<{ i?: string }>();
  const n = notices[Number(i)];
  const files = useMemo(() => (n ? n.files.map((f) => ({ name: f.name, paragraphs: noticeParagraphs(f.text) })) : []), [n]);
  if (!n) {
    return (
      <Screen testID="license-missing">
        <Header back title="Licence" />
        <EmptyState icon="code" title="That licence isn't here." body="Go back and pick a package from the list." />
      </Screen>
    );
  }
  return (
    <Screen testID="license">
      <Header back title="Licence" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: space[16], gap: space[5] }}>
        <View style={{ gap: space[1] }}>
          <T variant="title" accessibilityRole="header">
            {n.name}
          </T>
          <T variant="mono" color="textDim">
            {noticeMeta(n)}
          </T>
          {n.note ? (
            <T variant="caption" color="textDim">
              {n.note.charAt(0).toUpperCase() + n.note.slice(1)}
            </T>
          ) : null}
          {n.homepage ? (
            <T variant="body" color="text" accessibilityRole="link" accessibilityHint="Opens in your browser" style={{ textDecorationLine: "underline", marginTop: space[2] }} onPress={() => void Linking.openURL(n.homepage!)}>
              {n.homepage.replace(/^https:\/\//, "")}
            </T>
          ) : null}
        </View>
        {n.fallback ? (
          <View style={{ paddingLeft: space[3], borderLeftWidth: 2, borderLeftColor: c.line }}>
            <T variant="body" color="textDim">
              {FALLBACK_NOTE[n.fallback]}
            </T>
          </View>
        ) : null}
        {files.map((f) => (
          <View key={f.name} style={{ gap: space[3] }}>
            <T variant="monoLabel" color="textDim" accessibilityRole="header">
              {f.name}
            </T>
            {f.paragraphs.map((p, k) => (
              <T key={k} variant="body" color="textDim" selectable>
                {p}
              </T>
            ))}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}
