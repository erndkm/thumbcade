import { validateManifest, type Manifest } from "@thumbcade/protocol";

/** A game the simulator can load. */
export interface GameSource {
  slug: string;
  name: string;
  entryUrl: string;
  manifestUrl: string;
  /** Poster URL relative to the manifest, if any. */
  posterUrl: string | null;
  iconUrl: string | null;
}

/** What `/__thumbcade/config.json` returns (served by `thumbcade dev` or the workspace dev plugin). */
export interface SimConfig {
  mode: "cli" | "workspace" | "url";
  games: GameSource[];
  defaultSlug?: string;
  creatorHandle?: string;
}

export interface LoadedGame {
  source: GameSource;
  manifest: Manifest | null;
  manifestIssues: string[];
  sameOrigin: boolean;
}

export async function loadConfig(): Promise<SimConfig> {
  const q = new URLSearchParams(location.search);
  const explicit = q.get("game");
  if (explicit) {
    const entry = new URL(explicit, location.href);
    const base = new URL("./", entry);
    return {
      mode: "url",
      games: [
        {
          slug: q.get("slug") ?? "game",
          name: q.get("name") ?? entry.host,
          entryUrl: entry.href,
          manifestUrl: new URL("thumbcade.json", base).href,
          posterUrl: null,
          iconUrl: null,
        },
      ],
    };
  }
  try {
    const res = await fetch("/__thumbcade/config.json", { cache: "no-store" });
    if (res.ok) return (await res.json()) as SimConfig;
  } catch {
    /* static hosting without a config endpoint */
  }
  return { mode: "url", games: [] };
}

export async function loadGame(source: GameSource): Promise<LoadedGame> {
  let manifest: Manifest | null = null;
  let issues: string[] = [];
  try {
    const res = await fetch(source.manifestUrl, { cache: "no-store" });
    if (!res.ok) issues = [`thumbcade.json: HTTP ${res.status}`];
    else {
      const parsed = validateManifest(await res.json());
      if (parsed.ok) manifest = parsed.manifest;
      else issues = parsed.issues;
    }
  } catch (err) {
    issues = [`thumbcade.json could not be loaded (${err instanceof Error ? err.message : String(err)})`];
  }
  const base = new URL("./", new URL(source.manifestUrl, location.href));
  const sourceWithAssets: GameSource = {
    ...source,
    name: manifest?.name ?? source.name,
    posterUrl: manifest?.poster ? new URL(manifest.poster, base).href : source.posterUrl,
    iconUrl: manifest ? new URL(manifest.icon, base).href : source.iconUrl,
  };
  return {
    source: sourceWithAssets,
    manifest,
    manifestIssues: issues,
    sameOrigin: new URL(source.entryUrl, location.href).origin === location.origin,
  };
}
