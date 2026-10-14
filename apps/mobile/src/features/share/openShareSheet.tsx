import { useRef, useState } from "react";
import { Share, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import type * as MediaLibraryNS from "expo-media-library";
import { captureRef } from "react-native-view-shot";
import { formatScore, gameShareUrl, type FeedCard } from "@thumbcade/protocol";
import { createShare } from "../../lib/api";
import { env } from "../../lib/env";
import { track } from "../../lib/events";
import { openSheet } from "../../state/sheets";
import { toast } from "../../state/toast";
import { useAuth } from "../../state/auth";
import { useMe } from "../../hooks/useMe";
import { Avatar } from "../../ui/Avatar";
import { Wordmark } from "../../ui/Brand";
import { GameIcon } from "../../ui/GameIcon";
import { Icon, type IconName } from "../../ui/Icon";
import { Press } from "../../ui/Press";
import { SheetDragArea } from "../../ui/Sheet";
import { SheetTitle } from "../../ui/SheetRow";
import { BusyDots } from "../../ui/Skeleton";
import { T } from "../../ui/Text";
import { accentOf, alpha, c, layout, radius, space } from "../../ui/theme";
import { registerShareChallenge } from "../../feed/services";
import { patchGameEverywhere, requireMember } from "../social";

type Mode = "share" | "challenge";

/**
 * expo-media-library is loaded lazily: Expo Go on Android ships without its native module and throws on
 * import. Without it, the share card goes to the system share sheet (which offers "Save image").
 */
function loadMediaLibrary(): typeof MediaLibraryNS | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native module (see above)
    return require("expo-media-library") as typeof MediaLibraryNS;
  } catch {
    return null;
  }
}

/**
 * Share sheet: a custom first row (Challenge link · Copy link · Save share card) above the system
 * share sheet. Resolves with whether something was actually shared (for the SDK's share.challenge).
 */
export function openShareSheet(card: FeedCard, score: number | null, mode: Mode = "share"): Promise<boolean> {
  return new Promise((resolve) => {
    let shared = false;
    openSheet({
      key: "share",
      snap: 0.64,
      accessibilityLabel: mode === "challenge" ? "Challenge a friend" : "Share",
      onClose: () => resolve(shared),
      render: (close) => (
        <ShareSheet
          card={card}
          score={score}
          mode={mode}
          onShared={() => {
            shared = true;
          }}
          onClose={close}
        />
      ),
    });
  });
}

// Games call tc.share.challenge({ score }) -> this flow.
registerShareChallenge((card, score) => openShareSheet(card, score, "challenge"));

function ShareSheet({ card, score, mode, onShared, onClose }: { card: FeedCard; score: number | null; mode: Mode; onShared: () => void; onClose: () => void }) {
  const shot = useRef<View>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const me = useMe();
  const name = card.game.name;
  const scoreText = score !== null ? formatScore(score, card.game.score) : null;

  const counted = useRef(false);
  const markShared = (channel: string) => {
    onShared();
    track({ type: "share", gameId: card.game.id, meta: { channel } });
    if (!counted.current) {
      counted.current = true;
      patchGameEverywhere(card.game.id, { sharesDelta: 1 });
    }
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
    } catch {
      toast("That share didn't go through. Try again.", "bad");
    } finally {
      setBusy(null);
    }
  };

  const guest = useAuth((st) => st.isGuest);
  /** Members get a tracked share code; guests share the plain game URL (share codes are members-only). */
  const mint = async (channel: "link" | "card" | "system") =>
    guest ? null : await createShare({ gameId: card.game.id, channel, ...(score !== null && channel !== "link" && mode === "challenge" ? { score } : null) }).catch(() => null);

  const challenge = () => {
    if (guest) {
      onClose();
      setTimeout(() => requireMember(`Sign up to challenge friends on ${name}.`, () => void openShareSheet(card, score, "challenge")), 260);
      return;
    }
    return run("challenge", async () => {
      if (score === null) return;
      const res = await createShare({ gameId: card.game.id, channel: "challenge", score });
      const url = res.challengeUrl ?? res.gameUrl;
      const result = await Share.share({ message: `I scored ${scoreText} on ${name}. Beat me: ${url}`, url });
      if (result.action !== Share.dismissedAction) {
        markShared("challenge");
        onClose();
      }
    });
  };

  const copy = () =>
    run("copy", async () => {
      const res = await mint("link");
      await Clipboard.setStringAsync(res?.gameUrl ?? gameShareUrl(card.game.slug, env.shareBase));
      markShared("link");
      toast("Link copied. Paste it somewhere loud.", "good");
    });

  const saveCard = () =>
    run("card", async () => {
      const uri = await captureRef(shot, { format: "png", quality: 1, width: 1080, height: 1350, result: "tmpfile" });
      const MediaLibrary = loadMediaLibrary();
      if (MediaLibrary) {
        const perm = await MediaLibrary.requestPermissionsAsync(true);
        if (!perm.granted) {
          toast("Allow photo access to save share cards.", "bad");
          return;
        }
        await MediaLibrary.saveToLibraryAsync(uri);
        toast("Share card saved to Photos.", "good");
      } else {
        await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Save or send your share card", UTI: "public.png" });
      }
      void mint("card");
      markShared("card");
    });

  const system = () =>
    run("system", async () => {
      const res = await mint("system");
      const url = res?.gameUrl ?? gameShareUrl(card.game.slug, env.shareBase);
      const result = await Share.share({ message: `${name} on Thumbcade: ${card.game.description} ${url}`, url });
      if (result.action !== Share.dismissedAction) markShared("system");
    });

  return (
    <View style={{ flex: 1 }}>
      <SheetDragArea>
        <SheetTitle>{mode === "challenge" ? "Challenge a friend" : "Share"}</SheetTitle>
      </SheetDragArea>
      <View style={{ alignItems: "center", paddingVertical: space[2] }}>
        <View ref={shot} collapsable={false}>
          <ShareCard card={card} scoreText={scoreText} playerName={me.data?.is_guest ? null : (me.data?.handle ?? null)} playerSeed={me.data?.avatar_seed ?? "guest"} />
        </View>
      </View>
      <View style={{ flexDirection: "row", paddingHorizontal: layout.gutter, gap: space[2], marginTop: space[3] }}>
        <Tile icon="bolt" label="Challenge link" hint={score === null ? "Play a run first" : guest ? "Sign up to send challenges" : `With your ${scoreText}`} disabled={score === null} busy={busy === "challenge"} onPress={challenge} testID="share-challenge" primary={mode === "challenge"} />
        <Tile icon="link" label="Copy link" busy={busy === "copy"} onPress={copy} testID="share-copy" />
        <Tile icon="download" label="Save share card" busy={busy === "card"} onPress={saveCard} testID="share-card" />
        <Tile icon="share" label="More" busy={busy === "system"} onPress={system} testID="share-system" />
      </View>
    </View>
  );
}

function Tile({ icon, label, hint, onPress, disabled, busy, primary, testID }: { icon: IconName; label: string; hint?: string; onPress: () => void; disabled?: boolean; busy?: boolean; primary?: boolean; testID?: string }) {
  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      scaleTo={0.95}
      style={{ flex: 1, alignItems: "center", gap: space[2], opacity: disabled ? 0.4 : 1 }}
    >
      <View style={{ width: 56, height: 56, borderRadius: radius.sheetInner, backgroundColor: primary ? c.accent : c.raised, borderWidth: 1, borderColor: primary ? c.accent : c.line, alignItems: "center", justifyContent: "center" }}>
        {busy ? <BusyDots color={primary ? c.onAccent : c.text} size={5} /> : <Icon name={icon} size={24} color={primary ? c.onAccent : c.text} />}
      </View>
      <T variant="micro" align="center" numberOfLines={2}>
        {label}
      </T>
    </Press>
  );
}

/** The rendered share card: icon, score, creator. Captured at 1080×1350. */
export function ShareCard({ card, scoreText, playerName, playerSeed }: { card: FeedCard; scoreText: string | null; playerName: string | null; playerSeed: string }) {
  const accent = accentOf(card.game.accentColor);
  const W = 224;
  const H = 280;
  return (
    <View style={{ width: W, height: H, backgroundColor: c.surface, borderRadius: 18, borderCurve: "continuous", overflow: "hidden", borderWidth: 1, borderColor: c.line }}>
      <View style={{ position: "absolute", right: -60, top: -60, width: 200, height: 200, borderRadius: 100, borderWidth: 26, borderColor: alpha(accent, 0.14) }} />
      <View style={{ position: "absolute", right: -20, top: -20, width: 120, height: 120, borderRadius: 60, borderWidth: 14, borderColor: alpha(accent, 0.2) }} />
      <View style={{ height: 4, backgroundColor: accent }} />
      <View style={{ flex: 1, padding: 16, justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <GameIcon url={card.game.iconUrl} size={44} accent={card.game.accentColor} />
          <View style={{ flex: 1 }}>
            <T variant="headline" numberOfLines={1} maxFontSizeMultiplier={1}>
              {card.game.name}
            </T>
            <T variant="mono" color="textDim" numberOfLines={1} maxFontSizeMultiplier={1}>
              by @{card.creator.handle}
            </T>
          </View>
        </View>
        <View>
          <T variant="monoLabel" color="textDim" maxFontSizeMultiplier={1}>
            {scoreText ? "Score to beat" : "Play it now"}
          </T>
          {scoreText ? (
            <T variant="monoScore" numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1} style={{ fontSize: 44, lineHeight: 48 }}>
              {scoreText}
            </T>
          ) : (
            <T variant="display3" color={accent} numberOfLines={2} maxFontSizeMultiplier={1}>
              {card.game.tags.slice(0, 2).map((t) => `#${t}`).join(" ")}
            </T>
          )}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          {playerName ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Avatar seed={playerSeed} size={20} />
              <T variant="mono" maxFontSizeMultiplier={1}>
                @{playerName}
              </T>
            </View>
          ) : (
            <View />
          )}
          <Wordmark height={11} />
        </View>
      </View>
    </View>
  );
}
