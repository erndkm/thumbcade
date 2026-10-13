import { ControlsSchema, gameEntryUrl, gameOrigin, ScoreConfigSchema } from "@thumbcade/protocol";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icon";
import { ReviewReportView } from "@/components/review-report";
import { Chip } from "@/components/ui";
import { PhoneFeed } from "@/components/web-feed/phone-feed";
import type { WebCard } from "@/lib/data";
import { requireAdmin } from "@/lib/auth";
import { gameHostConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getWebViewer } from "@/lib/viewer";
import { DecisionForm } from "./decision-form";

export const metadata: Metadata = { title: "Review" };
export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  await requireAdmin(`/admin/review/${versionId}`);
  const supabase = await createClient();
  const { data: v } = await supabase
    .from("game_versions")
    .select("id, semver, status, manifest, review_report, release_notes, size_bytes, gzip_bytes, created_at, game:games!game_versions_game_id_fkey ( id, slug, name, description, tags, icon_url, poster_url, accent_color, age_rating, creator:profiles!games_creator_id_fkey ( id, handle, display_name, avatar_url, avatar_seed, verified ) )")
    .eq("id", versionId)
    .maybeSingle();
  if (!v) notFound();
  const game = v.game as unknown as {
    id: string;
    slug: string;
    name: string;
    description: string;
    tags: string[];
    icon_url: string | null;
    poster_url: string | null;
    accent_color: string;
    age_rating: string;
    creator: { id: string; handle: string; display_name: string; avatar_url: string | null; avatar_seed: string; verified: boolean };
  };
  const manifest = (v.manifest ?? {}) as { entry?: string; controls?: unknown; score?: unknown; audio?: boolean; ageRating?: string; description?: string; tags?: string[]; name?: string };
  const host = gameHostConfig();
  const controls = ControlsSchema.safeParse(manifest.controls);
  const score = ScoreConfigSchema.safeParse(manifest.score);
  // Review plays the exact submitted build, not the live one.
  const card: WebCard = {
    id: game.id,
    slug: game.slug,
    name: manifest.name ?? game.name,
    description: manifest.description ?? game.description,
    tags: manifest.tags ?? game.tags,
    iconUrl: game.icon_url,
    posterUrl: game.poster_url,
    accentColor: game.accent_color,
    controls: controls.success ? controls.data : { vertical: false, horizontal: false, multitouch: false, inputs: ["tap"] },
    score: score.success ? score.data : { order: "desc", max: 1_000_000, format: "integer" },
    audio: manifest.audio ?? true,
    ageRating: manifest.ageRating ?? game.age_rating,
    stats: { plays: 0, likes: 0, comments: 0, shares: 0, saves: 0 },
    version: { id: v.id, semver: v.semver, entryUrl: gameEntryUrl({ slug: game.slug, versionId: v.id, entry: manifest.entry ?? "index.html" }, host), origin: gameOrigin(game.slug, host) },
    creator: { id: game.creator.id, handle: game.creator.handle, displayName: game.creator.display_name, avatarUrl: game.creator.avatar_url, avatarSeed: game.creator.avatar_seed, verified: game.creator.verified },
    topScore: null,
  };
  const viewer = await getWebViewer();
  const reviewable = v.status === "pending_review" || v.status === "auto_failed";
  return (
    <div className="flex flex-col gap-10">
      <Link href="/admin" className="flex items-center gap-1 self-start text-[14px] text-text-dim hover:text-text">
        <Icon name="back" size={16} /> Review queue
      </Link>
      <div className="grid items-start gap-12 xl:grid-cols-[auto_1fr]">
        <div className="flex flex-col items-center gap-4 xl:sticky xl:top-8">
          <PhoneFeed cards={[card]} viewer={viewer} className="w-[min(92vw,380px)]" maxWidth={380} />
          <span className="label">Plays version {v.semver} exactly as submitted</span>
        </div>
        <div className="flex min-w-0 flex-col gap-10">
          <header className="flex flex-col gap-3">
            <span className="label">
              @{game.creator.handle} · v{v.semver} · {(Number(v.gzip_bytes) / 1024).toFixed(0)} KB gz
            </span>
            <h1 className="display text-[clamp(32px,4.4vw,56px)] text-text">{card.name}</h1>
            <p className="max-w-[620px] text-[16px] text-text-dim">{card.description}</p>
            <div className="flex flex-wrap gap-2">
              {card.tags.map((t) => (
                <Chip key={t}>#{t}</Chip>
              ))}
              <Chip>{card.ageRating}</Chip>
              <Chip>vertical: {String(card.controls.vertical)}</Chip>
              <Chip>{card.controls.inputs.join(" · ")}</Chip>
            </div>
            {v.release_notes ? <p className="text-[14px] text-text-mute">Release notes: {v.release_notes}</p> : null}
          </header>
          {reviewable ? <DecisionForm versionId={v.id} /> : <p className="rule-t rule-b py-4 text-[15px] text-text-dim">Status: {v.status.replace("_", " ")} — no decision needed.</p>}
          <section className="flex flex-col gap-4">
            <h2 className="font-wide text-[22px] font-extrabold tracking-tight text-text">Checklist for humans</h2>
            <ul className="grid gap-2 text-[15px] text-text-dim sm:grid-cols-2">
              {[
                "Attract mode is alive and readable under the overlay",
                "A run starts with a tap — never a swipe",
                "Swipes work as declared (vertical: " + String(card.controls.vertical) + ")",
                "Game over arrives fast and the score makes sense",
                "Nothing exceeds the age rating; no hateful or sexual content",
                "Original name and art — no clones of existing brands",
              ].map((t) => (
                <li key={t} className="flex gap-2">
                  <Icon name="check" size={16} className="mt-1 shrink-0 text-text-mute" /> {t}
                </li>
              ))}
            </ul>
          </section>
          <section className="flex flex-col gap-4">
            <h2 className="font-wide text-[22px] font-extrabold tracking-tight text-text">Automated report</h2>
            <ReviewReportView report={v.review_report} status={v.status} />
          </section>
        </div>
      </div>
    </div>
  );
}
