import { formatCount, safeAccent } from "@thumbcade/protocol";
import { ImageResponse } from "next/og";
import { getGameBySlug } from "@/lib/data";
import { brandMarkDataUrl, ogFonts } from "@/lib/og";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "A game on Thumbcade";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [game, fonts, mark] = await Promise.all([getGameBySlug(slug), ogFonts(), brandMarkDataUrl()]);
  const accent = game ? safeAccent(game.accentColor) : "#D4FF3D";
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#000", color: "#F3F0E8", padding: 64, position: "relative" }}>
        <div style={{ position: "absolute", right: -120, top: -120, width: 620, height: 620, borderRadius: 620, background: accent, opacity: 0.16, display: "flex" }} />
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            { }
            <img src={mark} width={44} height={44} alt="" />
            <span style={{ fontFamily: "Mono", fontSize: 22, letterSpacing: 1, color: "#A7A3AE" }}>THUMBCADE · PLAY FREE, NO INSTALL</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 44 }}>
            {game?.iconUrl ? (
               
              <img src={game.iconUrl} width={220} height={220} style={{ borderRadius: 50 }} alt="" />
            ) : (
              <div style={{ width: 220, height: 220, borderRadius: 50, background: accent, display: "flex" }} />
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 760 }}>
              <span style={{ fontFamily: "Display", fontSize: 96, lineHeight: 0.95, letterSpacing: -3 }}>{game?.name ?? "Thumbcade"}</span>
              <span style={{ fontFamily: "Sans", fontSize: 30, color: "#A7A3AE" }}>{game ? `@${game.creator.handle}` : ""}</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 40, fontFamily: "Mono", fontSize: 26, color: "#F3F0E8" }}>
            {game ? <span>▶ {formatCount(game.stats.plays)} PLAYS</span> : null}
            {game ? <span>♥ {formatCount(game.stats.likes)}</span> : null}
            {game ? <span style={{ color: accent }}>{game.tags.map((t) => `#${t}`).join("  ")}</span> : null}
          </div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
