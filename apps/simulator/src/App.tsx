import { useEffect, useMemo, useState, type FormEvent } from "react";
import lockupUrl from "@thumbcade/design-tokens/brand/lockup.svg?url";
import { DEVICES, type DeviceProfile } from "@thumbcade/sdk/host";
import { Phone } from "./feed/Phone.tsx";
import { Simulator } from "./lib/sim.ts";
import { loadConfig, loadGame, type LoadedGame, type SimConfig } from "./lib/source.ts";
import { useSim } from "./lib/useSim.ts";
import { Panels } from "./panels/Panels.tsx";
import { Icon } from "./ui/Icon.tsx";

type Boot = { state: "loading" } | { state: "empty"; config: SimConfig } | { state: "ready"; config: SimConfig; game: LoadedGame } | { state: "error"; message: string };

export function App() {
  const [boot, setBoot] = useState<Boot>({ state: "loading" });
  const [slug, setSlug] = useState<string | null>(() => new URLSearchParams(location.search).get("slug"));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const config = await loadConfig();
        const pick = config.games.find((g) => g.slug === slug) ?? config.games.find((g) => g.slug === config.defaultSlug) ?? config.games[0];
        if (!pick) {
          if (!cancelled) setBoot({ state: "empty", config });
          return;
        }
        const game = await loadGame(pick);
        if (!cancelled) setBoot({ state: "ready", config, game });
      } catch (err) {
        if (!cancelled) setBoot({ state: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const choose = (next: string) => {
    const q = new URLSearchParams(location.search);
    q.set("slug", next);
    history.replaceState(null, "", `?${q.toString()}`);
    setSlug(next);
  };

  if (boot.state === "ready") return <Workbench key={boot.game.source.entryUrl} config={boot.config} game={boot.game} onChoose={choose} />;
  return (
    <div className="app">
      <Header />
      <main className="empty">
        {boot.state === "loading" ? <div className="empty__card skeleton" aria-busy="true" /> : null}
        {boot.state === "empty" ? <EmptyState /> : null}
        {boot.state === "error" ? (
          <div className="empty__card">
            <p className="tc-mono-label empty__eyebrow">Simulator</p>
            <h1 className="tc-title">That didn't boot.</h1>
            <p className="empty__body">{boot.message}</p>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function EmptyState() {
  const [url, setUrl] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!url) return;
    const q = new URLSearchParams({ game: url });
    location.search = q.toString();
  };
  return (
    <div className="empty__card">
      <p className="tc-mono-label empty__eyebrow">Simulator</p>
      <h1 className="tc-display3">No game plugged in.</h1>
      <p className="empty__body">
        Run <code>npx thumbcade dev</code> in your game's folder and it opens here with hot reload, or paste the URL of a running game.
      </p>
      <form className="empty__form" onSubmit={submit}>
        <input className="input" type="url" placeholder="http://localhost:5174/index.html" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Game URL" />
        <button className="btn btn--primary" type="submit">
          Load
        </button>
      </form>
    </div>
  );
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="header">
      <div className="header__brand">
        <img src={lockupUrl} alt="Thumbcade" height={20} />
        <span className="header__divider" />
        <span className="tc-mono-label header__product">Simulator</span>
      </div>
      {children}
    </header>
  );
}

function Workbench({ config, game, onChoose }: { config: SimConfig; game: LoadedGame; onChoose: (slug: string) => void }) {
  const sim = useMemo(() => new Simulator(game), [game]);
  const snap = useSim(sim);
  const manifest = game.manifest;
  return (
    <div className="app">
      <Header>
        <div className="header__game">
          {config.games.length > 1 ? (
            <label className="select">
              <span className="sr-only">Game</span>
              <select value={game.source.slug} onChange={(e) => onChoose(e.target.value)}>
                {config.games.map((g) => (
                  <option key={g.slug} value={g.slug}>
                    {g.name}
                  </option>
                ))}
              </select>
              <Icon name="chevronDown" size={16} />
            </label>
          ) : (
            <span className="header__name">{game.source.name}</span>
          )}
          {manifest ? <span className="tc-mono header__version">v{manifest.version}</span> : null}
          <span className="chip chip--dev">DEV</span>
          {snap.sdkVersion ? <span className="tc-mono header__version">sdk {snap.sdkVersion}</span> : null}
        </div>
        <div className="header__tools">
          <div className="segmented" role="radiogroup" aria-label="Device">
            {(Object.values(DEVICES) as DeviceProfile[]).map((d) => (
              <button key={d.id} role="radio" aria-checked={snap.device.id === d.id} className="segmented__item" onClick={() => sim.setDevice(d.id)}>
                {d.label}
              </button>
            ))}
          </div>
          <button className={`tool ${snap.showInsets ? "tool--on" : ""}`} onClick={() => sim.toggleInsets()} aria-pressed={snap.showInsets} title="Show the areas the feed overlay covers">
            <Icon name="grid" size={18} />
            <span>Insets</span>
          </button>
          <button className={`tool ${snap.muted ? "" : "tool--on"}`} onClick={() => sim.toggleMute()} aria-pressed={!snap.muted} title={snap.muted ? "Unmute" : "Mute"}>
            <Icon name={snap.muted ? "soundOff" : "soundOn"} size={18} />
            <span>{snap.muted ? "Muted" : "Sound"}</span>
          </button>
          <button className="tool" onClick={() => sim.reload()} title="Reload the game (cold start)">
            <Icon name="replay" size={18} />
            <span>Reload</span>
          </button>
        </div>
      </Header>
      <main className="workbench">
        <section className="stage" aria-label="Phone">
          <Phone sim={sim} snap={snap} />
          <p className="stage__hint tc-mono-label">
            Drag to swipe · <kbd>Alt</kbd>-drag = two fingers · <kbd>↑</kbd> <kbd>↓</kbd> next / previous
          </p>
        </section>
        <Panels sim={sim} snap={snap} />
      </main>
    </div>
  );
}
