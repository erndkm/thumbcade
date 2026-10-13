import { formatScore, safeAccent } from "@thumbcade/protocol";
import { ImageResponse } from "next/og";
import { getChallenge } from "@/lib/data";
import { brandMarkDataUrl, ogFonts } from "@/lib/og";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "A Thumbcade challenge";

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [c, fonts, mark] = await Promise.all([getChallenge(code), ogFonts(), brandMarkDataUrl()]);
  const accent = c ? safeAccent(c.game.accentColor) : "#D4FF3D";
  const score = c && c.score !== null ? formatScore(c.score, c.game.score) : null;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#000", color: "#F3F0E8", padding: 64 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          { }
          <img src={mark} width={44} height={44} alt="" />
          <span style={{ fontFamily: "Mono", fontSize: 22, letterSpacing: 1, color: "#A7A3AE" }}>CHALLENGE FROM {(c?.fromName ?? "A FRIEND").toUpperCase()}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontFamily: "Sans", fontSize: 40, color: "#A7A3AE" }}>Beat</span>
          <span style={{ fontFamily: "Mono", fontSize: 180, lineHeight: 1, color: accent, letterSpacing: -6 }}>{score ?? "—"}</span>
          <span style={{ fontFamily: "Display", fontSize: 64, letterSpacing: -2 }}>on {c?.game.name ?? "Thumbcade"}.</span>
        </div>
        <span style={{ fontFamily: "Mono", fontSize: 24, color: "#6E6A78" }}>THUMBCADE.COM · TAP TO ACCEPT</span>
      </div>
    ),
    { ...size, fonts },
  );
}
