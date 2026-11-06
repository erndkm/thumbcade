import type { Metadata } from "next";
import { Button, Field, Input } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { deleteRow, saveRow } from "../actions";

export const metadata: Metadata = { title: "Editorial" };
export const dynamic = "force-dynamic";

export default async function EditorialPage() {
  await requireAdmin("/admin/editorial");
  const supabase = await createClient();
  const [{ data: rows }, { data: games }] = await Promise.all([
    supabase.from("editorial_rows").select("*").order("position"),
    supabase.from("games").select("id, slug, name").eq("status", "live").order("name"),
  ]);
  const slugOf = new Map((games ?? []).map((g) => [g.id, g.slug]));
  const Row = ({ row }: { row?: { id: string; title: string; subtitle: string | null; game_ids: string[]; active: boolean; position: number } }) => (
    <form action={saveRow} className="grid gap-4 rounded-[18px] border border-line bg-surface p-5 md:grid-cols-[1fr_1fr_2fr_90px_auto]">
      <input type="hidden" name="id" value={row?.id ?? ""} />
      <Field label="Title">
        <Input name="title" defaultValue={row?.title} placeholder="Under 30 seconds" required />
      </Field>
      <Field label="Subtitle">
        <Input name="subtitle" defaultValue={row?.subtitle ?? ""} placeholder="Quick hits for the bus stop" />
      </Field>
      <Field label="Games (slugs, in order)">
        <Input name="games" defaultValue={(row?.game_ids ?? []).map((id) => slugOf.get(id)).filter(Boolean).join(" ")} className="font-mono" placeholder="flapjack stackd kneejerk" />
      </Field>
      <Field label="Order">
        <Input name="position" type="number" defaultValue={row?.position ?? (rows?.length ?? 0)} />
      </Field>
      <div className="flex items-end gap-3 pb-1">
        <label className="flex h-12 items-center gap-2 text-[14px] text-text-dim">
          <input type="checkbox" name="active" defaultChecked={row?.active ?? true} className="size-4 accent-[var(--tc-accent)]" /> Live
        </label>
        <Button type="submit" size="sm">{row ? "Save" : "Add row"}</Button>
      </div>
    </form>
  );
  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <span className="label">Discover</span>
        <h1 className="display text-[clamp(36px,5vw,64px)] text-text">Editorial rows</h1>
        <p className="max-w-[620px] text-[16px] leading-6 text-text-dim">Curated rows on the app&apos;s Discover tab. Live games only: {(games ?? []).map((g) => g.slug).join(", ") || "none yet"}.</p>
      </header>
      <div className="flex flex-col gap-4">
        {(rows ?? []).map((r) => (
          <div key={r.id} className="flex flex-col gap-2">
            <Row row={r} />
            <form action={deleteRow} className="self-end">
              <input type="hidden" name="id" value={r.id} />
              <button type="submit" className="text-[13px] text-text-mute hover:text-heat">Delete row</button>
            </form>
          </div>
        ))}
        <span className="label mt-4">New row</span>
        <Row />
      </div>
    </div>
  );
}
