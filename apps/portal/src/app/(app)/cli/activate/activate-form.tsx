"use client";
import { useActionState } from "react";
import { Icon } from "@/components/icon";
import { Button, Input } from "@/components/ui";
import { approveDevice, type ActivateState } from "./actions";

export function ActivateForm({ initialCode }: { initialCode: string }) {
  const [state, action, pending] = useActionState<ActivateState, FormData>(approveDevice, null);
  if (state?.done)
    return (
      <div className="flex items-center gap-3 rounded-[16px] border border-accent/40 bg-accent/5 p-5 text-[16px] text-text">
        <Icon name="check" size={22} className="text-accent-text" /> Connected. Head back to your terminal.
      </div>
    );
  return (
    <form action={action} className="flex flex-col gap-4">
      <Input name="code" defaultValue={initialCode} placeholder="ABCD-1234" className="h-16 text-center font-mono text-[28px] uppercase tracking-[0.3em]" maxLength={9} required />
      {state?.error ? <p className="text-[14px] text-heat">{state.error}</p> : null}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Connecting…" : "Approve this device"}
      </Button>
    </form>
  );
}
