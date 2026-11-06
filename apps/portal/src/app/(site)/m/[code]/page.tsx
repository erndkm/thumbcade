import { milestoneCopy } from "@thumbcade/protocol";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GameHero } from "@/components/game-hero";
import { ButtonLink } from "@/components/ui";
import { PhoneFeed } from "@/components/web-feed/phone-feed";
import { getLeaders, getLiveGames, getMilestoneCard } from "@/lib/data";
import { getWebViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const m = await getMilestoneCard(code);
  if (!m) return { title: "Milestone not found" };
  const copy = milestoneCopy(m.card, m.card.game.name);
  return { title: `${m.card.game.name}: ${copy.title}`, description: `${copy.body} Play it free on Thumbcade.` };
}

export default async function MilestonePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const m = await getMilestoneCard(code);
  if (!m) notFound();
  const [others, leaders, viewer] = await Promise.all([getLiveGames(24), getLeaders(m.game.id, m.game.score.order), getWebViewer()]);
  const cards = [m.game, ...others.filter((g) => g.id !== m.game.id)];
  const copy = milestoneCopy(m.card, m.card.game.name);
  return (
    <section className="mx-auto grid max-w-[1280px] items-start gap-14 px-4 pb-10 pt-12 md:px-8 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-20 lg:pt-16">
      <GameHero
        card={m.game}
        leaders={leaders}
        eyebrow={
          <div className="flex items-center gap-3 self-start rounded-pill border border-line-strong py-1.5 pl-4 pr-4">
            <span className="text-[14px] text-text-dim">
              <strong className="font-semibold text-text">@{m.card.creator.handle}</strong> made this game
            </span>
          </div>
        }
        title={
          <>
            <span className="text-accent-text">{copy.figureText}</span> {copy.figureLabel}
            <br />
            on {m.card.game.name}.
          </>
        }
      >
        <div className="flex flex-wrap gap-3">
          <ButtonLink href="/#get" size="lg">
            Play {m.card.game.name} in the app
          </ButtonLink>
        </div>
      </GameHero>
      <div className="flex flex-col items-center gap-4 lg:sticky lg:top-24">
        <PhoneFeed cards={cards} viewer={viewer} className="w-[min(92vw,400px)]" maxWidth={400} />
        <span className="label">Tap the screen to play</span>
      </div>
    </section>
  );
}
