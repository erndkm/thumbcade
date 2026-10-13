"use client";
import { useActionState } from "react";
import { Button, Textarea } from "@/components/ui";
import { decide, type AdminState } from "../../actions";

export function DecisionForm({ versionId }: { versionId: string }) {
  const [state, action, pending] = useActionState<AdminState, FormData>(decide, null);
  return (
    <form action={action} className="flex flex-col gap-4 rounded-[20px] border border-line bg-surface p-5">
      <input type="hidden" name="versionId" value={versionId} />
      <span className="label">Decision</span>
      <Textarea name="notes" placeholder="Note to the creator (required to reject). Be specific: what to fix and why." />
      {state?.error ? <p className="text-[14px] text-heat">{state.error}</p> : null}
      <div className="grid grid-cols-2 gap-3">
        <Button type="submit" name="decision" value="reject" variant="secondary" disabled={pending}>
          Reject
        </Button>
        <Button type="submit" name="decision" value="approve" disabled={pending}>
          Approve & go live
        </Button>
      </div>
    </form>
  );
}
