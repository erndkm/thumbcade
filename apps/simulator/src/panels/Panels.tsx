import { BUDGETS, formatRelative } from "@thumbcade/protocol";
import { gestureConfigFor, type PanRule } from "@thumbcade/swipe-contract";
import { useEffect, useMemo, useRef, useState } from "react";
import { compactJson } from "../lib/format.ts";
import { DEV_INDEX, type LogItem, type Simulator, type SimSnapshot } from "../lib/sim.ts";
import { Icon } from "../ui/Icon.tsx";

export function Panels({ sim, snap }: { sim: Simulator; snap: SimSnapshot }) {
  return (
    <aside className="panels" aria-label="Inspector">
      {sim.game.manifestIssues.length ? <ManifestIssues issues={sim.game.manifestIssues} /> : null}
      <StatePanel sim={sim} snap={snap} />
      <ViolationsPanel sim={sim} snap={snap} />
      <PerfPanel snap={snap} />
      <ControlsPanel sim={sim} snap={snap} />
      <BridgePanel sim={sim} snap={snap} />
    </aside>
  );
}

function Section({ title, aside, children, grow }: { title: string; aside?: React.ReactNode; children: React.ReactNode; grow?: boolean }) {
  return (
    <section className={`panel ${grow ? "panel--grow" : ""}`}>
      <header className="panel__head">
        <h2 className="tc-mono-label">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

function ManifestIssues({ issues }: { issues: string[] }) {
  return (
    <Section title="thumbcade.json">
      <ul className="issues">
        {issues.map((i) => (
          <li key={i} className="issue issue--error">
            <span className="issue__mark" />
            <span className="tc-mono">{i}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function StatePanel({ sim, snap }: { sim: Simulator; snap: SimSnapshot }) {
  const s = snap.card;
  const onDev = snap.index === DEV_INDEX;
  const cfg = gestureConfigFor(s.phase, sim.controls);
  const c = sim.manifest?.controls;
  const flags: Array<[string, boolean]> = [
    ["ready", s.ready],
    ["active", s.active],
    ["running", s.gameRunning === true],
    ["feed drag", s.feedGesture],
  ];
  const rule = (r: PanRule) => (r.enabled ? `≥ ${r.activationDistance} pt${r.directionRatio > 1 ? ` · ${r.directionRatio}:1` : ""}` : "off");
  return (
    <Section
      title="Card"
      aside={
        <span className={`conn ${snap.connected ? "is-on" : ""}`}>
          {snap.connected ? `connected · input ${snap.observe}` : "waiting for hello"}
        </span>
      }
    >
      <div className="state">
        <div className="state__phase">
          <span className={`phase phase--${s.phase.toLowerCase()}`}>{s.phase}</span>
          {!onDev ? <span className="state__note">your game is {Math.abs(snap.index - DEV_INDEX) > 1 ? "recycled" : "offscreen"}</span> : null}
          {s.suspended.length ? <span className="state__note">suspended: {s.suspended.join(", ")}</span> : null}
        </div>
        <ul className="flags">
          {flags.map(([k, v]) => (
            <li key={k} className={`flag ${v ? "is-on" : ""}`}>
              {k}
            </li>
          ))}
          <li className="flag flag--stat">runs {s.runs}</li>
          {s.lastScore !== null ? <li className="flag flag--stat">last {s.lastScore.toLocaleString("en-US")}</li> : null}
        </ul>
        <table className="owner">
          <caption className="sr-only">Gesture ownership right now</caption>
          <tbody>
            <tr>
              <th>Surface pan</th>
              <td className="tc-mono">{cfg.gameOwnsSurface ? "game owns it" : rule(cfg.surfacePan)}</td>
            </tr>
            <tr>
              <th>Dock pan</th>
              <td className="tc-mono">{rule(cfg.dockPan)}</td>
            </tr>
            <tr>
              <th>Two fingers</th>
              <td className="tc-mono">{rule(cfg.twoFingerPan)}</td>
            </tr>
            <tr>
              <th>Chrome</th>
              <td className="tc-mono">
                {cfg.bottomBar} · overlay {cfg.overlay} · insets.{cfg.insets}
              </td>
            </tr>
            <tr>
              <th>Controls</th>
              <td className="tc-mono">{c ? `vertical ${c.vertical} · ${c.inputs.join(", ")}${c.multitouch ? " · multitouch" : ""}` : "—"}</td>
            </tr>
          </tbody>
        </table>
        {snap.gestureOwner ? <p className={`owner-now owner-now--${snap.gestureOwner}`}>This gesture belongs to the {snap.gestureOwner}.</p> : null}
      </div>
    </Section>
  );
}

function ViolationsPanel({ sim, snap }: { sim: Simulator; snap: SimSnapshot }) {
  const list = snap.violations;
  const errors = list.filter((v) => v.severity === "error").length;
  const [, force] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => force((n) => n + 1), 15_000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <Section
      title={`Contract${list.length ? ` · ${errors} error${errors === 1 ? "" : "s"}, ${list.length - errors} warning${list.length - errors === 1 ? "" : "s"}` : ""}`}
      aside={
        list.length ? (
          <button className="link" onClick={() => sim.clearViolations()}>
            Clear
          </button>
        ) : null
      }
    >
      {list.length === 0 ? (
        <p className="clean">
          <Icon name="check" size={16} />
          Clean. Start a run, swipe away, come back — anything that breaks the Swipe Contract shows up here.
        </p>
      ) : (
        <ul className="issues">
          {list.map((v) => (
            <li key={v.code} className={`issue issue--${v.severity}`}>
              <span className="issue__mark" />
              <div className="issue__body">
                <p className="issue__title">
                  {v.title}
                  {v.count > 1 ? <span className="tc-mono issue__count">×{v.count}</span> : null}
                  <span className="tc-mono issue__time">{formatRelative(v.at)}</span>
                </p>
                <p className="issue__detail">{v.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function PerfPanel({ snap }: { snap: SimSnapshot }) {
  const p = snap.perf;
  const tiles = [
    { label: "FPS", value: p.fps === null ? "—" : String(p.fps), budget: `≥ ${BUDGETS.minFps}`, bad: p.fps !== null && p.fps > 0 && p.fps < BUDGETS.minFps, note: snap.card.gameRunning ? "attract/play" : "paused" },
    { label: "Ready", value: p.readyMs === null ? "—" : `${(p.readyMs / 1000).toFixed(2)}s`, budget: `≤ ${(BUDGETS.readyMs / 1000).toFixed(1)}s`, bad: p.readyMs !== null && p.readyMs > BUDGETS.readyMs, note: "cold, unthrottled" },
    { label: "Long tasks", value: `${p.longTasks}`, budget: `≤ ${BUDGETS.longTaskMs}ms`, bad: p.longestTaskMs > BUDGETS.longTaskMs, note: p.longTasks ? `max ${p.longestTaskMs}ms` : "after ready" },
    { label: "Heap", value: p.heapMB === null ? "—" : `${p.heapMB}MB`, budget: `≤ ${BUDGETS.heapBytes / 1048576}MB`, bad: p.heapMB !== null && p.heapMB > BUDGETS.heapBytes / 1048576, note: "JS heap" },
  ];
  return (
    <Section title="Perf">
      <div className="tiles">
        {tiles.map((t) => (
          <div key={t.label} className={`tile ${t.bad ? "is-bad" : ""}`} title={t.note}>
            <span className="tc-mono-label tile__label">{t.label}</span>
            <span className="tile__value tc-mono">{t.value}</span>
            <span className="tile__budget tc-mono">{t.budget}</span>
            <span className="tile__note">{t.note}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

function ControlsPanel({ sim, snap }: { sim: Simulator; snap: SimSnapshot }) {
  const bg = snap.card.suspended.includes("background");
  return (
    <Section title="Simulate">
      <div className="controls">
        <button className="ctl" onClick={() => sim.simulate(bg ? "foreground" : "background")} aria-pressed={bg}>
          {bg ? "Bring app back" : "App to background"}
        </button>
        <button className="ctl" onClick={() => sim.simulate("back")} disabled={snap.card.phase !== "PLAYING"}>
          Android back
        </button>
        <button className="ctl" onClick={() => sim.simulate("idle")} disabled={snap.card.phase !== "PLAYING"}>
          20 s idle
        </button>
        <button className="ctl" onClick={() => sim.openSheet("comments")} disabled={snap.index !== DEV_INDEX}>
          Open a sheet
        </button>
      </div>
      <div className="controls controls--raw">
        <span className="tc-mono-label controls__label">Raw</span>
        {(["pause", "resume", "input.cancel", "replay"] as const).map((t) => (
          <button key={t} className="ctl ctl--mono" onClick={() => sim.send(t)} disabled={!snap.connected}>
            {t}
          </button>
        ))}
      </div>
    </Section>
  );
}

type Filter = "all" | "game" | "shell" | "dropped";

function BridgePanel({ sim, snap }: { sim: Simulator; snap: SimSnapshot }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [follow, setFollow] = useState(true);
  const listRef = useRef<HTMLOListElement>(null);
  const t0 = snap.log[0]?.at ?? 0;
  const rows = useMemo(() => snap.log.filter((l) => match(l, filter)), [snap.log, filter]);
  useEffect(() => {
    const el = listRef.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [rows, follow]);
  return (
    <Section
      grow
      title="Bridge"
      aside={
        <div className="bridge__tools">
          <div className="segmented segmented--small" role="radiogroup" aria-label="Filter">
            {(["all", "game", "shell", "dropped"] as const).map((f) => (
              <button key={f} role="radio" aria-checked={filter === f} className="segmented__item" onClick={() => setFilter(f)}>
                {f}
              </button>
            ))}
          </div>
          <button className="link" onClick={() => sim.clearLog()}>
            Clear
          </button>
        </div>
      }
    >
      <ol
        ref={listRef}
        className="log"
        onScroll={(e) => {
          const el = e.currentTarget;
          setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
        }}
      >
        {rows.length === 0 ? <li className="log__empty">Quiet line. Messages between your game and the shell appear here.</li> : null}
        {rows.map((l) => (
          <li key={l.n} className={`log__row log__row--${l.dir} ${l.dropped ? "is-dropped" : ""}`}>
            <span className="log__t tc-mono">{((l.at - t0) / 1000).toFixed(2)}</span>
            <span className="log__dir" aria-label={l.dir === "in" ? "game to shell" : l.dir === "out" ? "shell to game" : "shell"}>
              {l.dir === "in" ? "←" : l.dir === "out" ? "→" : "·"}
            </span>
            <span className="log__type tc-mono">{l.type}</span>
            <span className="log__payload tc-mono">{l.dropped ? `dropped: ${l.dropped}` : compactJson(l.payload)}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function match(l: LogItem, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "dropped") return !!l.dropped;
  if (f === "shell") return l.dir !== "in";
  return l.dir === "in";
}
