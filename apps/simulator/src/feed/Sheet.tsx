import type { Simulator } from "../lib/sim.ts";
import { Icon } from "../ui/Icon.tsx";

/**
 * Comments / share sheets. In the simulator they exist to exercise the "sheet opened over the card"
 * pause: the game must stop its loop and audio while one is open.
 */
export function Sheet({ sim, kind, score }: { sim: Simulator; kind: "comments" | "share"; score: number | null }) {
  const name = sim.manifest?.name ?? sim.game.source.name;
  return (
    <div className="sheet-layer">
      <button className="sheet-scrim" aria-label="Close" onClick={() => sim.closeSheet()} />
      <div className="sheet" role="dialog" aria-label={kind === "comments" ? "Comments" : "Share"}>
        <span className="sheet__grabber" />
        <div className="sheet__head">
          <span className="tc-headline">{kind === "comments" ? "Comments" : "Share"}</span>
          <button className="sheet__close" onClick={() => sim.closeSheet()} aria-label="Close">
            <Icon name="close" size={20} />
          </button>
        </div>
        {kind === "comments" ? (
          <div className="sheet__empty">
            <Icon name="comment" size={28} />
            <p className="tc-body-strong">Your game is paused under this sheet.</p>
            <p className="sheet__note">Players will argue about your hitboxes here. Check the bridge log: the shell sent pause with reason "sheet".</p>
          </div>
        ) : (
          <div className="sheet__share">
            <div className="share-preview">
              {sim.game.source.iconUrl ? <img src={sim.game.source.iconUrl} alt="" className="share-preview__icon" /> : null}
              <div className="share-preview__text">
                <span className="tc-body-strong">{score !== null ? `I scored ${score.toLocaleString("en-US")} on ${name}. Beat me.` : `Play ${name} with me.`}</span>
                <span className="tc-mono share-preview__link">thumbcade.com/{score !== null ? "c" : "g"}/{score !== null ? "k3x9q" : sim.manifest?.id ?? "your-game"}</span>
              </div>
            </div>
            <p className="sheet__note">This is what players send. In the app, challenge links open your game with ctx.challenge set. Your game is paused (reason "sheet") while this is open.</p>
          </div>
        )}
      </div>
    </div>
  );
}
