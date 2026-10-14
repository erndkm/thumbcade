import { router } from "expo-router";
import { ManifestSchema, type FeedCard } from "@thumbcade/protocol";
import { colors } from "@thumbcade/design-tokens";
import { rewriteLocalUrl } from "../../lib/env";
import { useDevCards } from "../../state/devCards";

/** Accepts `http(s)://host:port/path/` or `thumbcade://dev?url=<encoded>` (QR from `thumbcade dev --device`). */
export function parseDevTarget(input: string): string | null {
  const raw = input.trim();
  const fromScheme = /^thumbcade:\/\/dev\??(.*)$/i.exec(raw);
  const candidate = fromScheme ? new URLSearchParams(fromScheme[1] ?? "").get("url") ?? "" : raw;
  if (!/^https?:\/\/[^\s/]+/i.test(candidate)) return null;
  return candidate;
}

/** Builds a feed card for a game served from a developer's machine. Reads its thumbcade.json when reachable. */
export async function openDevGame(url: string): Promise<FeedCard> {
  const entry = rewriteLocalUrl(url.endsWith("/") ? `${url}index.html` : url);
  const base = entry.slice(0, entry.lastIndexOf("/") + 1);
  const origin = new URL(entry).origin;
  let manifest = null as null | ReturnType<typeof ManifestSchema.parse>;
  try {
    const res = await fetch(`${base}thumbcade.json`);
    if (res.ok) {
      const parsed = ManifestSchema.safeParse(await res.json());
      if (parsed.success) manifest = parsed.data;
    }
  } catch {
    // Dev servers may not expose the manifest; defaults below.
  }
  const id = manifest?.id ?? "dev-game";
  const card: FeedCard = {
    cardId: `dev:${Date.now().toString(36)}`,
    game: {
      id,
      slug: id,
      name: manifest?.name ?? "Dev build",
      description: manifest?.description ?? `Served from ${origin}`,
      iconUrl: manifest ? `${base}${manifest.icon}` : null,
      posterUrl: manifest?.poster ? `${base}${manifest.poster}` : null,
      accentColor: manifest?.accentColor ?? colors.dark.warning,
      tags: manifest?.tags ?? ["dev"],
      ageRating: manifest?.ageRating ?? "9+",
      controls: manifest?.controls ?? { vertical: false, horizontal: false, multitouch: false, inputs: ["tap"] },
      session: manifest?.session ?? "short",
      audio: manifest?.audio ?? true,
      score: manifest?.score ?? { order: "desc", max: 1_000_000, format: "integer" },
      stats: { plays: 0, likes: 0, comments: 0, shares: 0, saves: 0 },
    },
    version: { id: "dev", semver: manifest?.version ?? "0.0.0", entryUrl: entry, origin, sdkMajor: 1 },
    creator: { id: "00000000-0000-0000-0000-000000000000", handle: "you", displayName: "You", avatarUrl: null, avatarSeed: "dev", verified: false },
    viewer: { liked: false, saved: false, followingCreator: true, best: null },
    topScore: null,
    rank: { source: "editorial" },
  };
  useDevCards.getState().add(card);
  router.navigate("/");
  return card;
}
