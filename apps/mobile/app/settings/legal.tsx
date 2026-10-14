import { Linking, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { env } from "../../src/lib/env";
import { Header, Screen } from "../../src/ui/Screen";
import { T } from "../../src/ui/Text";
import { layout, space } from "../../src/ui/theme";

type Doc = { title: string; updated: string; sections: { h: string; p: string[] }[] };

const DOCS: Record<"terms" | "privacy" | "guidelines", Doc> = {
  terms: {
    title: "Terms of Service",
    updated: "October 2026",
    sections: [
      { h: "The short version", p: ["Thumbcade is a feed of small web games made by independent creators. Play fair, be decent to people, and don't try to break the arcade for everyone else."] },
      { h: "Your account", p: ["You can play without an account. If you sign up, keep your login to yourself; you're responsible for what happens under your handle.", "You must be at least 13 to like, comment, follow or appear on leaderboards. Younger players can play games rated for their age."] },
      { h: "Games", p: ["Games are made by creators, reviewed by us before they go live, and run in an isolated web view with no access to your device beyond sound, touch and the score and storage services we provide.", "Scores that look impossible are rejected automatically. Cheating gets scores removed and repeat offenders removed."] },
      { h: "What you post", p: ["Comments and profile details are yours, but you give us permission to show them inside Thumbcade. Don't post anything illegal, hateful, sexual, harassing or that you don't have the rights to.", "We can hide or remove content and suspend accounts that break these terms or the community guidelines."] },
      { h: "Leaving", p: ["Delete your account any time in Settings. It removes your profile and everything tied to it."] },
      { h: "Contact", p: [`Questions or concerns: ${env.contactEmail}`] },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    updated: "October 2026",
    sections: [
      { h: "What we collect", p: ["An account id (created anonymously the first time you open the app), your age range (never your birthday), and, if you sign up, your email or the identity from Apple or Google.", "What you do in the feed: which games you see, play, like, save, share and comment on, and your scores. We use this to rank your feed and run leaderboards."] },
      { h: "What games see", p: ["Games never see your email, your real account id, your device identifiers or any login token. Each game gets an opaque player id that only works inside that game, your display name and your avatar."] },
      { h: "What we don't do", p: ["No ads, no ad SDKs, no third-party trackers, no selling data. Analytics events are tied only to your account id."] },
      { h: "Your controls", p: ["Download everything we store about you from Settings → Download my data. Delete your account from Settings → Delete account; it's immediate and permanent."] },
      { h: "Contact", p: [`Privacy questions: ${env.contactEmail}`] },
    ],
  },
  guidelines: {
    title: "Community guidelines",
    updated: "October 2026",
    sections: [
      { h: "Trash talk the score, not the person", p: ["Rivalries are the point. Harassment, slurs, threats and pile-ons are not. A word filter catches the obvious stuff; humans handle the rest."] },
      { h: "Keep it for everyone", p: ["No sexual content, gore or self-harm content in comments, avatars or games. Games must match their age rating."] },
      { h: "Play it straight", p: ["No score exploits, bots or modified clients. If a game is broken, report it so the creator can fix it."] },
      { h: "Report and block", p: ["Long-press a comment, or open a profile or a game's menu, to report or block. Reports are private and every one is reviewed."] },
      { h: "Creators", p: ["Only publish games you made or have the rights to. Don't copy other games' names, art or trademarks. Reviewed builds are exactly what players run."] },
    ],
  },
};

export default function Legal() {
  const { doc } = useLocalSearchParams<{ doc?: string }>();
  const d = DOCS[(doc as keyof typeof DOCS) ?? "terms"] ?? DOCS.terms;
  return (
    <Screen>
      <Header back title={d.title} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: space[16], gap: space[5] }}>
        <T variant="mono" color="textDim">
          Last updated {d.updated}
        </T>
        {d.sections.map((s) => (
          <View key={s.h} style={{ gap: space[2] }}>
            <T variant="headline" accessibilityRole="header">
              {s.h}
            </T>
            {s.p.map((p, i) => (
              <T key={i} variant="body" color="textDim" onPress={p.includes(env.contactEmail) ? () => void Linking.openURL(`mailto:${env.contactEmail}`) : undefined}>
                {p}
              </T>
            ))}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}
