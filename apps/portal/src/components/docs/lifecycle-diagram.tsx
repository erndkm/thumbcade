/** Card phases and the SDK calls that move between them. */
export function LifecycleDiagram() {
  const node = (x: number, y: number, label: string, accent = false) => (
    <g>
      <rect x={x - 62} y={y - 20} width="124" height="40" rx="20" fill={accent ? "#FF4A3D" : "#17171C"} stroke={accent ? "#FF4A3D" : "#34343D"} />
      <text x={x} y={y + 5} textAnchor="middle" fontSize="13" fontWeight="700" fontFamily="var(--tc-font-sans)" fill={accent ? "#0D0D10" : "#F3F0E8"}>
        {label}
      </text>
    </g>
  );
  const edge = (x1: number, y1: number, x2: number, y2: number, label: string, ly = -8) => (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#6E6A78" strokeWidth="1.5" markerEnd="url(#arrow)" />
      <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 + ly} textAnchor="middle" fontSize="11" fontFamily="var(--tc-font-mono)" fill="#A7A3AE">
        {label}
      </text>
    </g>
  );
  return (
    <figure className="not-prose my-8 overflow-x-auto rounded-[18px] border border-line bg-surface p-4">
      <svg viewBox="0 0 900 250" className="h-auto w-full min-w-[640px]" role="img" aria-label="LOADING to PREVIEW on ready(); PREVIEW to PLAYING on gameplay.start(); PLAYING to ENDED on gameplay.end(); ENDED back to PLAYING on replay; PLAYING to PAUSED on pause and back on resume.">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="#6E6A78" />
          </marker>
        </defs>
        {node(80, 80, "LOADING")}
        {node(320, 80, "PREVIEW")}
        {node(570, 80, "PLAYING", true)}
        {node(820, 80, "ENDED")}
        {node(570, 205, "PAUSED")}
        {edge(142, 80, 258, 80, "ready()", -12)}
        {edge(382, 80, 508, 80, "gameplay.start()", -12)}
        {edge(632, 80, 758, 80, "gameplay.end()", -12)}
        <path d="M820 58 C 820 16, 590 16, 578 58" stroke="#6E6A78" strokeWidth="1.5" fill="none" markerEnd="url(#arrow)" />
        <text x="700" y="14" textAnchor="middle" fontSize="11" fontFamily="var(--tc-font-mono)" fill="#A7A3AE">replay → gameplay.start()</text>
        <line x1="556" y1="102" x2="556" y2="183" stroke="#6E6A78" strokeWidth="1.5" markerEnd="url(#arrow)" />
        <text x="546" y="146" textAnchor="end" fontSize="11" fontFamily="var(--tc-font-mono)" fill="#A7A3AE">pause</text>
        <line x1="584" y1="183" x2="584" y2="102" stroke="#6E6A78" strokeWidth="1.5" markerEnd="url(#arrow)" />
        <text x="594" y="146" textAnchor="start" fontSize="11" fontFamily="var(--tc-font-mono)" fill="#A7A3AE">resume</text>
      </svg>
    </figure>
  );
}
