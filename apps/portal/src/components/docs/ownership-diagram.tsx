/** The Swipe Contract ownership table as a diagram: who owns a vertical swipe, per phase and per game type. */
export function OwnershipDiagram() {
  const cols = ["Preview", "Playing", "Ended"];
  const rows: { label: string; sub: string; cells: ("feed" | "game" | "feed-strict")[] }[] = [
    { label: "Tap & horizontal games", sub: "controls.vertical: false", cells: ["feed", "feed-strict", "feed"] },
    { label: "Swipe & drag games", sub: "controls.vertical: true", cells: ["feed", "game", "feed"] },
  ];
  const Phone = ({ kind }: { kind: "feed" | "game" | "feed-strict" }) => (
    <svg viewBox="0 0 90 180" className="h-auto w-full max-w-[110px]" aria-hidden>
      <defs>
        <pattern id={`h-${kind}`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="4" height="8" fill={kind === "game" ? "rgba(255,74,61,0.35)" : "rgba(212,255,61,0.32)"} />
        </pattern>
      </defs>
      <rect x="1" y="1" width="88" height="178" rx="14" fill="#000" stroke="#34343D" />
      <rect x="5" y="5" width="80" height="152" rx="10" fill={`url(#h-${kind})`} opacity={kind === "feed-strict" ? 0.6 : 1} />
      <rect x="5" y="158" width="80" height="17" rx="4" fill={kind === "game" ? "rgba(212,255,61,0.35)" : "#17171C"} />
      <rect x="36" y="165" width="18" height="3" rx="1.5" fill={kind === "game" ? "#D4FF3D" : "#6E6A78"} />
      <text x="45" y="84" textAnchor="middle" fontSize="10" fontFamily="var(--tc-font-mono)" fill={kind === "game" ? "#FF4A3D" : "#D4FF3D"}>
        {kind === "game" ? "GAME" : "FEED"}
      </text>
      {kind === "feed-strict" ? (
        <text x="45" y="98" textAnchor="middle" fontSize="8" fontFamily="var(--tc-font-mono)" fill="#A7A3AE">
          ≥ 24pt
        </text>
      ) : null}
    </svg>
  );
  return (
    <figure className="not-prose my-8 overflow-x-auto rounded-[18px] border border-line bg-surface p-5">
      <div className="grid min-w-[520px] grid-cols-[1.3fr_repeat(3,1fr)] items-center gap-4">
        <span />
        {cols.map((c) => (
          <span key={c} className="label text-center">
            {c}
          </span>
        ))}
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <div>
              <div className="text-[14px] font-semibold text-text">{r.label}</div>
              <code className="!border-0 !bg-transparent !p-0 font-mono text-[12px] text-text-mute">{r.sub}</code>
            </div>
            {r.cells.map((k, i) => (
              <div key={i} className="flex justify-center">
                <Phone kind={k} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <figcaption className="mt-4 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[12px] text-text-mute">
        <span><span className="mr-2 inline-block size-2.5 bg-[rgba(212,255,61,0.6)]" />feed owns vertical swipes</span>
        <span><span className="mr-2 inline-block size-2.5 bg-[rgba(255,74,61,0.6)]" />game owns the surface</span>
        <span>bottom strip = tab bar / Dock — always the feed&apos;s</span>
      </figcaption>
    </figure>
  );
}
