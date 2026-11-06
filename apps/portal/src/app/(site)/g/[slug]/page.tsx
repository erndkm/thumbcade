import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GameHero } from "@/components/game-hero";
import { ButtonLink } from "@/components/ui";
import { PhoneFeed } from "@/components/web-feed/phone-feed";
import { getGameBySlug, getLeaders, getLiveGames } from "@/lib/data";
import { getWebViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const game = await getGameBySlug(slug);
  if (!game) return { title: "Game not found" };
  return {
    title: `${game.name} by @${game.creator.handle}`,
    description: `${game.description} Play it free in the Thumbcade app.`,
    openGraph: { title: `${game.name} — play it on Thumbcade`, description: game.description },
  };
}

export default async function GamePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const game = await getGameBySlug(slug);
  if (!game) notFound();
  const [others, leaders, viewer] = await Promise.all([getLiveGames(24), getLeaders(game.id, game.score.order), getWebViewer()]);
  const cards = [game, ...others.filter((g) => g.id !== game.id)];
  return (
    <section className="mx-auto grid max-w-[1280px] items-start gap-14 px-4 pb-10 pt-12 md:px-8 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-20 lg:pt-16">
      <GameHero
        card={game}
        leaders={leaders}
        eyebrow={<span className="label">Game · v{game.version.semver}</span>}
      >
        <div className="flex flex-wrap gap-3">
          <ButtonLink href="/#get" size="lg">
            Get the app
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
