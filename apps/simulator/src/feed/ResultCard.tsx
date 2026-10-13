import { formatScore, type Manifest } from "@thumbcade/protocol";
import { useEffect, useState } from "react";
import { formatMs } from "../lib/format.ts";
import type { RunResult, Simulator } from "../lib/sim.ts";
import { Icon } from "../ui/Icon.tsx";

/** The result card the shell shows on ENDED: odometer score, best, NEW BEST stamp, Play again, Challenge. */
export function ResultCard({ sim, result, manifest, top }: { sim: Simulator; result: RunResult; manifest: Manifest | null; top: number }) {
  const text = formatScore(result.score, manifest?.score);
  return (
    <div className="result" role="dialog" aria-label="Run over" style={{ top }}>
      <div className="result__card" onPointerDown={(e) => sim.onChromePointerDown(e, "chrome")}>
        <p className="tc-mono-label result__eyebrow">Run over</p>
        <Odometer text={text} />
        {result.isNewBest ? <span className="result__stamp">NEW BEST</span> : null}
        <dl className="result__stats">
          <div>
            <dt className="tc-mono-label">Best</dt>
            <dd className="tc-mono">{result.best === null ? "—" : formatScore(result.best, manifest?.score)}</dd>
          </div>
          <div>
            <dt className="tc-mono-label">Run</dt>
            <dd className="tc-mono">{formatMs(result.durationMs)}</dd>
          </div>
        </dl>
        <div className="result__actions">
          <button className="btn btn--primary" onClick={() => !sim.shouldSuppressClick() && sim.replay()}>
            <Icon name="replay" size={18} />
            Play again
          </button>
          <button className="btn btn--ghost" onClick={() => !sim.shouldSuppressClick() && sim.openSheet("share")}>
            Challenge a friend
          </button>
        </div>
      </div>
      <p className="result__hint tc-mono-label">
        <span className="result__chevron">
          <Icon name="swipeUp" size={16} />
        </span>
        Swipe up for the next game
      </p>
    </div>
  );
}

/** Digits roll into place like a mechanical counter. */
function Odometer({ text }: { text: string }) {
  const [rolled, setRolled] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setRolled(true));
    return () => cancelAnimationFrame(t);
  }, [text]);
  return (
    <div className="odometer" aria-label={text}>
      {text.split("").map((ch, i) => {
        const d = Number.parseInt(ch, 10);
        if (Number.isNaN(d)) {
          return (
            <span key={i} className="odometer__sep" aria-hidden="true">
              {ch}
            </span>
          );
        }
        return (
          <span key={i} className="odometer__col" aria-hidden="true">
            <span className="odometer__reel" style={{ transform: `translateY(${rolled ? -d : 0}em)`, transitionDelay: `${(text.length - i) * 45}ms` }}>
              {"0123456789".split("").map((n) => (
                <span key={n}>{n}</span>
              ))}
            </span>
          </span>
        );
      })}
    </div>
  );
}
