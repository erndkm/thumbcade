import { milestoneCopy, safeAccent } from "@thumbcade/protocol";
import { ImageResponse } from "next/og";
import { getMilestoneCard } from "@/lib/data";
import { brandMarkDataUrl, imageDataUrl, ogFonts } from "@/lib/og";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "A Thumbcade milestone";

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [m, fonts, mark] = await Promise.all([getMilestoneCard(code), ogFonts(), brandMarkDataUrl()]);
  const accent = m ? safeAccent(m.card.game.accentColor, "#000000") : "#FF4A3D";
  const copy = m ? milestoneCopy(m.card, m.card.game.name) : null;
  const icon = await imageDataUrl(m?.game.iconUrl);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#000", color: "#F3F0E8", padding: 64 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <img src={mark} width={44} height={44} alt="" />
          <span style={{ fontFamily: "Mono", fontSize: 22, letterSpacing: 1, color: "#A7A3AE" }}>
            {(copy?.title ?? "Milestone").toUpperCase()} · @{(m?.card.creator.handle ?? "thumbcade").toUpperCase()}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 40 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontFamily: "Mono", fontSize: 168, lineHeight: 1, color: accent, letterSpacing: -6 }}>{copy?.figureText ?? "—"}</span>
            <span style={{ fontFamily: "Sans", fontSize: 40, color: "#A7A3AE" }}>{copy?.figureLabel ?? ""}</span>
            <span style={{ fontFamily: "Display", fontSize: 64, letterSpacing: -2 }}>on {m?.card.game.name ?? "Thumbcade"}.</span>
          </div>
          {icon ? <img src={icon} width={180} height={180} alt="" style={{ borderRadius: 44 }} /> : null}
        </div>
        <span style={{ fontFamily: "Mono", fontSize: 24, color: "#6E6A78" }}>THUMBCADE.COM · TAP TO PLAY</span>
      </div>
    ),
    { ...size, fonts },
  );
}
