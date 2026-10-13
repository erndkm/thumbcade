"use client";
import { contrastRatio } from "@thumbcade/protocol";
import { useActionState, useMemo, useRef, useState } from "react";
import { GameIcon } from "@/components/game-icon";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { createClient } from "@/lib/supabase/browser";
import { updateGame, type FormState } from "../../actions";

export function MetadataForm({
  game,
}: {
  game: { slug: string; name: string; description: string; tags: string[]; accent_color: string; icon_url: string | null };
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateGame, null);
  const [accent, setAccent] = useState(game.accent_color);
  const [iconUrl, setIconUrl] = useState(game.icon_url);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [desc, setDesc] = useState(game.description);
  const file = useRef<HTMLInputElement>(null);
  const supabase = useMemo(() => createClient(), []);
  const ratio = /^#[0-9A-Fa-f]{6}$/.test(accent) ? contrastRatio(accent, "#0D0D10") : 0;

  async function upload(f: File) {
    setUploadError(null);
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) return setUploadError("PNG, JPEG or WebP only.");
    if (f.size > 2 * 1024 * 1024) return setUploadError("Keep icons under 2 MB.");
    const img = await createImageBitmap(f);
    if (img.width !== img.height || img.width < 512) return setUploadError(`Icons must be square and at least 512 px (this one is ${img.width}×${img.height}).`);
    setUploading(true);
    const path = `${game.slug}/icon-${Date.now()}.${f.type.split("/")[1]}`;
    const { error } = await supabase.storage.from("game-assets").upload(path, f, { contentType: f.type, upsert: false });
    setUploading(false);
    if (error) return setUploadError("Upload failed. You can only upload icons for your own games.");
    setIconUrl(supabase.storage.from("game-assets").getPublicUrl(path).data.publicUrl);
  }

  return (
    <form action={action} className="grid gap-8 lg:grid-cols-[auto_1fr]">
      <input type="hidden" name="slug" value={game.slug} />
      <input type="hidden" name="iconUrl" value={iconUrl ?? ""} />
      <div className="flex flex-col items-start gap-3">
        <span className="label">Profile picture</span>
        <GameIcon url={iconUrl} name={game.name} accent={accent} size={128} />
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        <Button type="button" variant="secondary" size="sm" onClick={() => file.current?.click()} disabled={uploading}>
          {uploading ? "Uploading…" : "Replace icon"}
        </Button>
        {uploadError ? <span className="max-w-[160px] text-[12px] text-heat">{uploadError}</span> : <span className="max-w-[160px] text-[12px] text-text-mute">Square, 1024 px recommended.</span>}
      </div>
      <div className="flex flex-col gap-6">
        <div className="grid gap-6 sm:grid-cols-[1fr_200px]">
          <Field label="Name">
            <Input name="name" defaultValue={game.name} maxLength={32} required />
          </Field>
          <Field
            label="Accent"
            hint={ratio >= 3 ? `${ratio.toFixed(1)}:1 on ink — good` : "Below 3:1 on ink; the app falls back to paper"}
          >
            <div className="flex items-center gap-2">
              <input type="color" value={/^#[0-9A-Fa-f]{6}$/.test(accent) ? accent : "#D4FF3D"} onChange={(e) => setAccent(e.target.value.toUpperCase())} className="h-12 w-12 shrink-0 cursor-pointer rounded-input border border-line bg-surface p-1" aria-label="Pick accent color" />
              <Input name="accentColor" value={accent} onChange={(e) => setAccent(e.target.value)} className="font-mono uppercase" maxLength={7} />
            </div>
          </Field>
        </div>
        <Field label="Description" hint={`${desc.length}/120 — shown under the game name in the feed.`}>
          <Textarea name="description" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={120} required />
        </Field>
        <Field label="Hashtags" hint="1–5, separated by spaces. The first one is the primary tag.">
          <Input name="tags" defaultValue={game.tags.map((t) => `#${t}`).join(" ")} className="font-mono" />
        </Field>
        <div className="flex items-center gap-4">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
          {state?.error ? <span className="text-[14px] text-heat">{state.error}</span> : null}
          {state?.ok ? <span className="text-[14px] text-accent-text">{state.ok}</span> : null}
        </div>
      </div>
    </form>
  );
}
