"use client";
import { useActionState, useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { createToken, type FormState } from "../actions";

export function TokenForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createToken, null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-5">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-[320px]">
          <Field label="Token name">
            <Input name="name" placeholder="MacBook · CI" maxLength={60} />
          </Field>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create token"}
        </Button>
      </form>
      {state?.error ? <p className="text-[14px] text-heat">{state.error}</p> : null}
      {state?.token ? (
        <div className="flex flex-col gap-3 rounded-[16px] border border-success/40 bg-success/5 p-5">
          <span className="text-[14px] text-text">Copy it now — you won&apos;t see it again.</span>
          <div className="flex flex-wrap items-center gap-3">
            <code className="rounded-[10px] border border-line bg-surface px-3 py-2 font-mono text-[14px] text-text">{state.token}</code>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(state.token!);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <code className="font-mono text-[13px] text-text-dim">npx thumbcade login --token {state.token}</code>
        </div>
      ) : null}
    </div>
  );
}
