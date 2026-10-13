import { formatScore } from "@thumbcade/protocol";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { GameHero } from "@/components/game-hero";
import { Icon } from "@/components/icon";
import { ButtonLink } from "@/components/ui";
import { PhoneFeed } from "@/components/web-feed/phone-feed";
import { getChallenge, getLeaders, getLiveGames } from "@/lib/data";
import { getWebViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const c = await getChallenge(code);
  if (!c) return { title: "Challenge not found" };
  const score = c.score !== null ? formatScore(c.score, c.game.score) : null;
  return {
    title: `${c.fromName} challenged you on ${c.game.name}`,
    description: score ? `${c.fromName} scored ${score}. Think you can beat it? Play free on Thumbcade.` : `Play ${c.game.name} free on Thumbcade.`,
  };
}

export default async function ChallengePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const c = await getChallenge(code);
  if (!c) notFound();
  const [others, leaders, viewer] = await Promise.all([getLiveGames(24), getLeaders(c.game.id, c.game.score.order), getWebViewer()]);
  const cards = [c.game, ...others.filter((g) => g.id !== c.game.id)];
  const score = c.score !== null ? formatScore(c.score, c.game.score) : null;
  return (
    <section className="mx-auto grid max-w-[1280px] items-start gap-14 px-4 pb-10 pt-12 md:px-8 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-20 lg:pt-16">
      <GameHero
        card={c.game}
        leaders={leaders}
        eyebrow={
          <div className="flex items-center gap-3 rounded-pill border border-line-strong py-1.5 pl-1.5 pr-4 self-start">
            <Avatar url={c.fromAvatarUrl} seed={c.fromAvatarSeed} size={30} />
            <span className="text-[14px] text-text-dim">
              <strong className="font-semibold text-text">{c.fromHandle ? `@${c.fromHandle}` : c.fromName}</strong> sent you a challenge
            </span>
          </div>
        }
        title={
          score ? (
            <>
              Beat <span className="text-accent-text">{score}</span>
              <br />
              on {c.game.name}.
            </>
          ) : (
            c.game.name
          )
        }
      >
        <div className="flex flex-wrap gap-3">
          <ButtonLink href={`/play?g=${c.game.slug}`} size="lg">
            <Icon name="play" size={18} active /> Accept the challenge
          </ButtonLink>
          <ButtonLink href="/#get" size="lg" variant="secondary">
            Get the app
          </ButtonLink>
        </div>
      </GameHero>
      <div className="flex flex-col items-center gap-4 lg:sticky lg:top-24">
        <PhoneFeed
          cards={cards}
          viewer={viewer}
          challenge={c.score !== null ? { fromName: c.fromName, score: c.score } : undefined}
          className="w-[min(92vw,400px)]"
          maxWidth={400}
        />
        <span className="label">Tap the screen to play</span>
      </div>
    </section>
  );
}
