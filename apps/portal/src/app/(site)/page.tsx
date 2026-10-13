import { BUDGETS, formatCount } from "@thumbcade/protocol";
import Link from "next/link";
import QRCode from "qrcode";
import { Avatar } from "@/components/avatar";
import { GameIcon } from "@/components/game-icon";
import { Icon } from "@/components/icon";
import { ButtonLink, Chip } from "@/components/ui";
import { PhoneFeed } from "@/components/web-feed/phone-feed";
import { getLiveGames, getPlatformStats } from "@/lib/data";
import { env } from "@/lib/env";
import { getWebViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

export default async function Landing() {
  const [games, stats, viewer] = await Promise.all([getLiveGames(24), getPlatformStats(), getWebViewer()]);
  const qr = await QRCode.toString(`${env.siteUrl}/play`, { type: "svg", margin: 0, color: { dark: "#0D0D10", light: "#00000000" } });
  const featured = games[0] ?? null;
  const appStore = process.env.NEXT_PUBLIC_APP_STORE_URL;
  const playStore = process.env.NEXT_PUBLIC_PLAY_STORE_URL;

  return (
    <>
      {/* ------------------------------------------------------------------ HERO */}
      <section id="play" className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(60% 50% at 78% 42%, rgba(212,255,61,0.10), transparent 70%)" }}
        />
        <div className="relative mx-auto grid max-w-[1280px] items-center gap-14 px-4 pb-24 pt-14 md:px-8 lg:grid-cols-[1fr_auto] lg:gap-20 lg:pt-20">
          <div className="flex flex-col gap-8">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="label flex items-center gap-2 !text-text-dim">
                <span className="inline-block size-2 rounded-full bg-volt shadow-[0_0_0_4px_rgba(212,255,61,0.18)]" />
                Now playing
              </span>
              <span className="label">{stats.games} games live</span>
              <span className="label">0 downloads per game</span>
            </div>
            <h1 className="display text-[clamp(56px,9.4vw,136px)] text-text">
              Swipe up
              <br />
              for the next
              <br />
              <span className="relative inline-block">
                game.
                <svg aria-hidden viewBox="0 0 300 24" className="absolute -bottom-2 left-0 h-[0.16em] w-full" preserveAspectRatio="none">
                  <path d="M2 16 C 80 4, 160 4, 298 12" stroke="var(--tc-accent)" strokeWidth="8" fill="none" strokeLinecap="round" />
                </svg>
              </span>
            </h1>
            <p className="max-w-[520px] text-[19px] leading-[29px] text-text-dim">
              Thumbcade is an endless feed of games you play with one thumb. Five seconds or five minutes — then swipe, and the next one is
              already running. No installs, no menus, no loading bars.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <ButtonLink href="#get" size="lg">
                Get the app
              </ButtonLink>
              <ButtonLink href="/play" size="lg" variant="secondary">
                <Icon name="play" size={18} active /> Play in your browser
              </ButtonLink>
            </div>
            <dl className="mt-4 grid max-w-[560px] grid-cols-3 border-t border-line pt-6">
              <div>
                <dt className="label">Next game</dt>
                <dd className="mt-1 font-mono text-[22px] text-text">&lt; 1 s</dd>
              </div>
              <div>
                <dt className="label">Creators</dt>
                <dd className="mt-1 font-mono text-[22px] text-text">{formatCount(stats.creators)}</dd>
              </div>
              <div>
                <dt className="label">Thumbs needed</dt>
                <dd className="mt-1 font-mono text-[22px] text-text">1</dd>
              </div>
            </dl>
          </div>
          <div className="flex flex-col items-center gap-4">
            <PhoneFeed cards={games} viewer={viewer} className="w-[min(92vw,414px)]" />
            <span className="label flex items-center gap-2">
              <Icon name="swipeUp" size={14} /> Drag to swipe · ↑ ↓ keys · tap to play
            </span>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ SHELF */}
      {games.length > 0 ? (
        <section aria-label="Games in the feed" className="border-y border-line py-8">
          <div className="overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
            <ul className="marquee flex w-max gap-4 px-4">
              {[...games, ...games].map((g, i) => (
                <li key={`${g.id}-${i}`} aria-hidden={i >= games.length}>
                  <Link href={`/g/${g.slug}`} className="group flex w-[264px] items-center gap-4 rounded-[18px] border border-line bg-surface p-3 pr-4 transition-colors hover:border-line-strong">
                    <GameIcon url={g.iconUrl} name={g.name} accent={g.accentColor} size={56} />
                    <span className="min-w-0">
                      <span className="block truncate font-semiwide text-[15px] font-bold text-text">{g.name}</span>
                      <span className="block truncate text-[13px] text-text-mute">@{g.creator.handle}</span>
                      <span className="mt-1 block truncate font-mono text-[11px] text-text-mute">{g.tags.map((t) => `#${t}`).join(" ")}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------------------------ SWIPE CONTRACT */}
      <section id="swipe-contract" className="mx-auto max-w-[1280px] px-4 pt-32 md:px-8">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
          <div className="reveal flex flex-col gap-6">
            <span className="label">01 — The Swipe Contract</span>
            <h2 className="display text-[clamp(40px,5.6vw,76px)] text-text">A swipe never means two things.</h2>
            <p className="max-w-[460px] text-[17px] leading-7 text-text-dim">
              Some games need vertical swipes — runners, snakes, sliding numbers. On Thumbcade every card knows who owns your thumb, so a
              jump never turns into “next game” by accident.
            </p>
            <ul className="mt-2 flex flex-col gap-3 text-[15px] text-text-dim">
              <li className="flex gap-3">
                <Icon name="bolt" size={18} className="mt-0.5 shrink-0 text-volt" active />
                Taps are never delayed. The game gets your touch instantly.
              </li>
              <li className="flex gap-3">
                <Icon name="bolt" size={18} className="mt-0.5 shrink-0 text-volt" active />
                There&apos;s always a way out: the Dock at the bottom edge.
              </li>
              <li className="flex gap-3">
                <Icon name="bolt" size={18} className="mt-0.5 shrink-0 text-volt" active />
                No double-tap-to-like. Your double-taps belong to the game.
              </li>
            </ul>
          </div>
          <div className="reveal grid grid-cols-3 gap-3 sm:gap-6">
            <ContractPanel step="Preview" title="Swipe anywhere." body="The game is alive behind the feed. Vertical swipes move the feed; taps start the game." owner="feed" />
            <ContractPanel step="Playing" title="The game owns the screen." body="Games that use swipes get every pixel. The tab bar becomes the Dock — swipe there to leave." owner="game" />
            <ContractPanel step="Ended" title="Score, then go." body="Your run, your best, today's rank. Play again, challenge a friend, or swipe on." owner="result" />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ SOCIAL */}
      {featured ? (
        <section className="mx-auto max-w-[1280px] px-4 pt-32 md:px-8">
          <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20">
            <div className="reveal order-2 rounded-[28px] border border-line bg-surface p-6 sm:p-8 lg:order-1">
              <div className="flex items-start gap-5">
                <GameIcon url={featured.iconUrl} name={featured.name} accent={featured.accentColor} size={96} />
                <div className="min-w-0 flex-1">
                  <span className="label">Game page</span>
                  <h3 className="mt-1 font-wide text-[32px] font-black leading-9 tracking-tight text-text">{featured.name}</h3>
                  <div className="mt-2 flex items-center gap-2 text-[14px] text-text-dim">
                    <Avatar url={featured.creator.avatarUrl} seed={featured.creator.avatarSeed} size={22} /> @{featured.creator.handle}
                  </div>
                </div>
              </div>
              <p className="mt-6 text-[16px] leading-6 text-text-dim">{featured.description}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {featured.tags.map((t) => (
                  <Chip key={t}>#{t}</Chip>
                ))}
              </div>
              <dl className="mt-8 grid grid-cols-3 gap-4 border-t border-line pt-6">
                {[
                  ["Plays", formatCount(featured.stats.plays)],
                  ["Likes", formatCount(featured.stats.likes)],
                  ["Comments", formatCount(featured.stats.comments)],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="label">{k}</dt>
                    <dd className="mt-1 font-mono text-[24px] text-text tabular">{v}</dd>
                  </div>
                ))}
              </dl>
              <ButtonLink href={`/g/${featured.slug}`} variant="secondary" className="mt-8 w-full">
                Open {featured.name}
              </ButtonLink>
            </div>
            <div className="reveal order-1 flex flex-col gap-6 lg:order-2">
              <span className="label">02 — Social, built in</span>
              <h2 className="display text-[clamp(40px,5.6vw,76px)] text-text">Every game has a face.</h2>
              <p className="max-w-[460px] text-[17px] leading-7 text-text-dim">
                A profile picture, a name, a creator and hashtags you can follow down the rabbit hole. Like it, save it, argue about it in the
                comments — then send a challenge link with your score on it.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------------------------ CREATORS */}
      <section id="creators" className="mx-auto max-w-[1280px] px-4 pt-32 md:px-8">
        <div className="reveal flex flex-col gap-6">
          <span className="label">{featured ? "03" : "02"} — For creators</span>
          <h2 className="display max-w-[900px] text-[clamp(40px,6.4vw,92px)] text-text">Your game in this feed by Friday.</h2>
          <p className="max-w-[560px] text-[17px] leading-7 text-text-dim">
            If you can build it for the web, you can ship it here. Canvas, Phaser, PixiJS, Three.js — bring your engine. We bring millions of
            thumbs.
          </p>
        </div>
        <div className="mt-14 grid gap-px overflow-hidden rounded-[24px] border border-line bg-line lg:grid-cols-3">
          {[
            { n: "01", title: "Scaffold", cmd: "npm create thumbcade-game@latest", body: "Pick a template. You get a small, complete game with the SDK already wired in." },
            { n: "02", title: "Play it in the feed", cmd: "thumbcade dev", body: "The simulator runs your game inside the real feed chrome, with the Swipe Contract enforced live." },
            { n: "03", title: "Ship", cmd: "thumbcade publish", body: "Automated review checks budgets and the contract. A human plays it. Then it's live — no app update." },
          ].map((s) => (
            <div key={s.n} className="reveal flex flex-col gap-5 bg-bg p-7">
              <span className="font-mono text-[13px] text-volt">{s.n}</span>
              <h3 className="font-wide text-[24px] font-extrabold tracking-tight text-text">{s.title}</h3>
              <code className="block rounded-[12px] border border-line bg-surface px-4 py-3 font-mono text-[13px] text-text">
                <span className="text-text-mute">$ </span>
                {s.cmd}
                <span className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 bg-volt [animation:caret_1s_steps(1)_infinite]" />
              </code>
              <p className="text-[15px] leading-6 text-text-dim">{s.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-[24px] border border-line bg-line md:grid-cols-4">
          {[
            ["SDK", "8 KB", "gzipped, zero deps"],
            ["Initial payload", `${BUDGETS.initialPayloadGzipBytes / 1024 / 1024} MB`, "gzipped, before ready()"],
            ["Ready in", `${(BUDGETS.readyMs / 1000).toFixed(1)} s`, "on a mid-range phone"],
            ["Frame rate", `${BUDGETS.minFps}+ fps`, "in attract mode"],
          ].map(([k, v, s]) => (
            <div key={k} className="flex flex-col gap-1 bg-bg p-6">
              <span className="label">{k}</span>
              <span className="font-mono text-[32px] leading-10 text-text">{v}</span>
              <span className="text-[13px] text-text-mute">{s}</span>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-wrap gap-3">
          <ButtonLink href="/docs" size="lg">
            Read the quickstart
          </ButtonLink>
          <ButtonLink href="/creator" size="lg" variant="secondary">
            Open the dashboard
          </ButtonLink>
        </div>
      </section>

      {/* ------------------------------------------------------------------ GET */}
      <section id="get" className="mx-auto max-w-[1280px] px-4 pt-32 md:px-8">
        <div className="reveal relative overflow-hidden rounded-[32px] bg-volt p-8 text-ink-1 sm:p-14">
          <div className="grid items-center gap-10 md:grid-cols-[1fr_auto]">
            <div className="flex flex-col gap-5">
              <span className="font-mono text-[12px] uppercase tracking-wider text-ink-1/60">Get Thumbcade</span>
              <h2 className="display text-[clamp(44px,6.4vw,96px)]">
                One thumb.
                <br />
                No end.
              </h2>
              <p className="max-w-[460px] text-[17px] leading-7 text-ink-1/75">
                Scan to play on your phone right now. The iPhone and Android apps add your feed, your saves and your scores.
              </p>
              <div className="flex flex-wrap gap-3">
                {appStore ? (
                  <a href={appStore} className="inline-flex h-12 items-center rounded-pill bg-ink-1 px-6 font-semiwide text-[15px] font-bold text-paper">
                    Download for iPhone
                  </a>
                ) : null}
                {playStore ? (
                  <a href={playStore} className="inline-flex h-12 items-center rounded-pill bg-ink-1 px-6 font-semiwide text-[15px] font-bold text-paper">
                    Get it for Android
                  </a>
                ) : null}
                <Link href="/play" className="inline-flex h-12 items-center gap-2 rounded-pill border-2 border-ink-1 px-6 font-semiwide text-[15px] font-bold">
                  <Icon name="play" size={16} active /> Play in your browser
                </Link>
              </div>
            </div>
            <div className="flex flex-col items-center gap-3">
              <div className="size-44 rounded-[20px] bg-paper p-4" dangerouslySetInnerHTML={{ __html: qr }} aria-label="QR code to play Thumbcade on your phone" role="img" />
              <span className="font-mono text-[11px] uppercase tracking-wider text-ink-1/60">Point your camera here</span>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function ContractPanel({ step, title, body, owner }: { step: string; title: string; body: string; owner: "feed" | "game" | "result" }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="relative aspect-[9/19] overflow-hidden rounded-[22px] border border-line-strong bg-black">
        {owner === "feed" ? (
          <>
            <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,rgba(212,255,61,0.16)_0_6px,transparent_6px_14px)]" />
            <div className="absolute inset-x-[30%] top-[38%] flex flex-col items-center gap-1 text-volt">
              <Icon name="swipeUp" size={28} />
              <span className="font-mono text-[9px] uppercase tracking-wider">feed</span>
            </div>
            <div className="absolute right-[6%] top-[40%] flex flex-col gap-2">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="block size-3 rounded-full bg-paper/40" />
              ))}
            </div>
            <div className="absolute bottom-[12%] left-[8%] h-1.5 w-1/2 rounded bg-paper/40" />
            <div className="absolute bottom-[8%] left-[8%] h-1.5 w-1/3 rounded bg-paper/25" />
          </>
        ) : owner === "game" ? (
          <>
            <div className="absolute inset-x-0 top-0 bottom-[9%] bg-[repeating-linear-gradient(135deg,rgba(255,74,61,0.2)_0_6px,transparent_6px_14px)]" />
            <div className="absolute inset-x-[30%] top-[38%] flex flex-col items-center gap-1 text-heat">
              <Icon name="grid" size={26} />
              <span className="font-mono text-[9px] uppercase tracking-wider">game</span>
            </div>
            <div className="absolute inset-x-0 bottom-0 flex h-[9%] items-center justify-center border-t border-volt/60 bg-volt/20">
              <span className="block h-1 w-1/4 rounded-full bg-volt" />
            </div>
          </>
        ) : (
          <>
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/60" />
            <div className="absolute inset-x-[8%] bottom-[14%] flex flex-col gap-2 rounded-[12px] border border-white/10 bg-ink-2 p-3">
              <span className="font-mono text-[18px] leading-none text-paper">412</span>
              <span className="block h-1 w-2/3 rounded bg-volt" />
              <div className="mt-1 grid grid-cols-2 gap-1.5">
                <span className="block h-3 rounded-full bg-paper/80" />
                <span className="block h-3 rounded-full border border-paper/40" />
              </div>
            </div>
            <div className="absolute inset-x-[30%] top-[28%] flex flex-col items-center gap-1 text-volt">
              <Icon name="swipeUp" size={24} />
            </div>
          </>
        )}
      </div>
      <div>
        <span className="font-mono text-[11px] uppercase tracking-wider text-text-mute">{step}</span>
        <h3 className="mt-1 font-semiwide text-[17px] font-bold leading-6 text-text">{title}</h3>
        <p className="mt-1 hidden text-[14px] leading-5 text-text-dim sm:block">{body}</p>
      </div>
    </div>
  );
}
