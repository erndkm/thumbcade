"use client";
import { useActionState, useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { deleteAccount, type DeleteState } from "./actions";

export function DeleteForm() {
  const [state, action, pending] = useActionState<DeleteState, FormData>(deleteAccount, null);
  const [text, setText] = useState("");
  return (
    <form action={action} className="flex flex-wrap items-start gap-3">
      <div className="w-full max-w-[240px]">
        <Field label="Type DELETE to confirm" error={state?.error}>
          <Input name="confirm" value={text} onChange={(e) => setText(e.target.value.toUpperCase())} placeholder="DELETE" autoComplete="off" className="font-mono" />
        </Field>
      </div>
      <Button type="submit" variant="danger" className="sm:mt-[26px]" disabled={pending || text.trim() !== "DELETE"}>
        {pending ? "Deleting…" : "Delete everything"}
      </Button>
    </form>
  );
}
