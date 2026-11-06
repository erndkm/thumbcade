import { memo, useMemo, useState } from "react";
import { FlatList, ScrollView, TextInput, View } from "react-native";
import { router } from "expo-router";
import { filterNotices, LICENSES, noticeMeta, notices } from "../../src/features/licenses/notices";
import { EmptyState } from "../../src/ui/EmptyState";
import { Icon } from "../../src/ui/Icon";
import { Press } from "../../src/ui/Press";
import { Header, Screen, SectionTitle } from "../../src/ui/Screen";
import { T } from "../../src/ui/Text";
import { c, layout, radius, space, type } from "../../src/ui/theme";

type Row = { k: "section"; key: string; title: string } | { k: "notice"; i: number };

const FONT_COUNT = notices.filter((n) => n.kind === "font").length;
const PACKAGE_COUNT = notices.length - FONT_COUNT;

/** Open-source licences: every third-party package and font in the app, with search and a licence filter. */
export default function Licenses() {
  const [text, setText] = useState("");
  const [license, setLicense] = useState<string | null>(null);
  const rows = useMemo(() => {
    const hits = filterNotices(text, license);
    const fonts = hits.filter((i) => notices[i]!.kind === "font");
    const rest = hits.filter((i) => notices[i]!.kind !== "font");
    const out: Row[] = [];
    if (fonts.length) out.push({ k: "section", key: "fonts", title: "Fonts" }, ...fonts.map((i) => ({ k: "notice" as const, i })));
    if (rest.length) out.push({ k: "section", key: "packages", title: `Packages · ${rest.length}` }, ...rest.map((i) => ({ k: "notice" as const, i })));
    return out;
  }, [text, license]);

  return (
    <Screen testID="licenses">
      <Header back title="Open-source licences" />
      <View style={{ paddingHorizontal: layout.gutter, paddingBottom: space[2] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], backgroundColor: c.raised, borderRadius: radius.input, paddingHorizontal: space[3], minHeight: 44 }}>
          <Icon name="search" size={18} color={c.textDim} />
          <TextInput
            testID="licenses-search"
            value={text}
            onChangeText={setText}
            placeholder="Search packages or licences"
            placeholderTextColor={c.textMute}
            selectionColor={c.accent}
            keyboardAppearance="dark"
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            maxFontSizeMultiplier={1.35}
            style={[type("body"), { flex: 1, color: c.text, paddingVertical: space[2] }]}
            accessibilityLabel="Search packages or licences"
          />
          {text ? (
            <Press onPress={() => setText("")} accessibilityLabel="Clear search" hitSlop={10}>
              <Icon name="close" size={16} color={c.textDim} />
            </Press>
          ) : null}
        </View>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => (r.k === "section" ? r.key : String(r.i))}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={16}
        maxToRenderPerBatch={24}
        windowSize={9}
        removeClippedSubviews
        contentContainerStyle={{ paddingBottom: space[16] }}
        ListHeaderComponent={<Intro license={license} onLicense={setLicense} />}
        ListEmptyComponent={<EmptyState icon="search" title={`Nothing matches "${text.trim()}".`} body={license ? `Try another search, or show all licences instead of ${license} only.` : "Search by package name or licence, like react or MIT."} />}
        renderItem={({ item }) => (item.k === "section" ? <SectionTitle>{item.title}</SectionTitle> : <NoticeRow i={item.i} />)}
      />
    </Screen>
  );
}

function Intro({ license, onLicense }: { license: string | null; onLicense: (license: string | null) => void }) {
  return (
    <View style={{ gap: space[4], paddingTop: space[2] }}>
      <T variant="body" color="textDim" style={{ paddingHorizontal: layout.gutter }}>
        Thumbcade is built with open-source software. These are the {PACKAGE_COUNT} packages and {FONT_COUNT} fonts that go into this app, each with the licence and copyright notices it comes with.
      </T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space[2], paddingHorizontal: layout.gutter }} accessibilityLabel="Filter by licence">
        <Chip label="All" count={notices.length} on={license === null} onPress={() => onLicense(null)} />
        {LICENSES.map((l) => (
          <Chip key={l.license} label={l.license} count={l.count} on={license === l.license} onPress={() => onLicense(license === l.license ? null : l.license)} />
        ))}
      </ScrollView>
    </View>
  );
}

function Chip({ label, count, on, onPress }: { label: string; count: number; on: boolean; onPress: () => void }) {
  return (
    <Press
      onPress={onPress}
      accessibilityState={{ selected: on }}
      accessibilityLabel={label === "All" ? `All licences, ${count} entries` : `${label}, ${count} ${count === 1 ? "entry" : "entries"}`}
      testID={`licence-chip-${label}`}
      scaleTo={0.95}
      style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 40, paddingHorizontal: space[3], borderRadius: radius.chip, borderWidth: 1, borderColor: on ? c.accent : c.line, backgroundColor: on ? c.accent : c.surface }}
    >
      <T variant="mono" color={on ? "onAccent" : "text"}>
        {label}
      </T>
      <T variant="mono" color={on ? "onAccent" : "textDim"}>
        {count}
      </T>
    </Press>
  );
}

const NoticeRow = memo(function NoticeRow({ i }: { i: number }) {
  const n = notices[i]!;
  return (
    <Press
      onPress={() => router.push({ pathname: "/settings/license", params: { i: String(i) } })}
      scaleTo={0.99}
      accessibilityLabel={`${n.name}, ${n.version ? `version ${n.version}, ` : ""}${n.license}`}
      accessibilityHint="Opens the licence text"
      testID={`notice-${n.name}`}
      style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: layout.gutter, paddingVertical: space[2] }}
    >
      <View style={{ flex: 1, gap: space[0.5] }}>
        <T variant="bodyStrong">{n.name}</T>
        <T variant="mono" color="textDim">
          {noticeMeta(n)}
        </T>
        {n.note ? (
          <T variant="caption" color="textMute">
            {n.note}
          </T>
        ) : null}
      </View>
      <Icon name="forward" size={18} color={c.textMute} />
    </Press>
  );
});
