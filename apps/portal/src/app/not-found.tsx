import Link from "next/link";
import { Lockup } from "@/components/brand";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex h-16 w-full max-w-[1280px] items-center px-4 md:px-8">
        <Lockup height={26} />
      </header>
      <main className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col justify-center gap-8 px-4 pb-24 md:px-8">
        <span className="label">404 · Game over</span>
        <h1 className="display text-[clamp(56px,10vw,150px)] text-text">
          Nothing here.
          <br />
          <span className="text-text-mute">Swipe on.</span>
        </h1>
        <p className="max-w-[460px] text-[17px] leading-7 text-text-dim">That link points at a game, a challenge or a page that doesn&apos;t exist — or doesn&apos;t anymore.</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/#play" className="inline-flex h-14 items-center rounded-pill bg-accent px-7 font-semiwide text-[17px] font-bold text-on-accent">
            Play something else
          </Link>
          <Link href="/" className="inline-flex h-14 items-center rounded-pill border border-line-strong px-7 font-semiwide text-[17px] font-bold text-text">
            Home
          </Link>
        </div>
      </main>
    </div>
  );
}
