"use client";
import { useActionState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { becomeCreator, type FormState } from "./actions";

export function CreatorOnboarding({ handle, displayName }: { handle: string; displayName: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(becomeCreator, null);
  return (
    <form action={action} className="flex max-w-[480px] flex-col gap-6">
      <Field label="Handle" hint="Shown on every game you publish. Lowercase, 3–24 characters.">
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-mute">@</span>
          <Input name="handle" defaultValue={handle.startsWith("player") ? "" : handle} required className="pl-8" placeholder="pixelwitch" />
        </div>
      </Field>
      <Field label="Display name">
        <Input name="displayName" defaultValue={displayName.startsWith("player") ? "" : displayName} required placeholder="Ines Kroll" />
      </Field>
      <label className="flex items-start gap-3 text-[14px] leading-5 text-text-dim">
        <input type="checkbox" name="terms" className="mt-0.5 size-4 accent-[var(--tc-accent)]" />
        <span>
          I agree to the creator terms: my games are original or properly licensed, contain no third-party tracking, and follow the{" "}
          <a href="/docs/review" className="text-text underline decoration-accent underline-offset-2">review guidelines</a>.
        </span>
      </label>
      {state?.error ? <p className="text-[14px] text-heat">{state.error}</p> : null}
      <Button type="submit" size="lg" disabled={pending} className="self-start">
        {pending ? "Setting up…" : "Become a creator"}
      </Button>
    </form>
  );
}
