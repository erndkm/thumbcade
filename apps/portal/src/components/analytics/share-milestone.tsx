"use client";
import { useState, useTransition } from "react";
import { shareMilestone } from "@/app/(app)/creator/actions";
import { Icon } from "../icon";
import { Button } from "../ui";

/**
 * Turns a milestone into a public share card (`/m/<code>`) and copies its link. Nothing about a milestone is
 * public until its creator does this.
 */
export function ShareMilestone({ id, existingCode, size = "sm", label = "Share" }: { id: string; existingCode: string | null; size?: "sm" | "md"; label?: string }) {
  const [code, setCode] = useState(existingCode);
  const [state, setState] = useState<"idle" | "copied" | "shown" | "error">("idle");
  const [pending, start] = useTransition();
  const url = code && typeof window !== "undefined" ? `${window.location.origin}/m/${code}` : null;

  const share = () =>
    start(async () => {
      let c = code;
      if (!c) {
        const res = await shareMilestone(id);
        if ("error" in res) {
          setState("error");
          return;
        }
        c = res.code;
        setCode(c);
      }
      const link = `${window.location.origin}/m/${c}`;
      try {
        await navigator.clipboard.writeText(link);
        setState("copied");
      } catch {
        setState("shown");
      }
    });

  return (
    <span className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="secondary" size={size} onClick={share} disabled={pending}>
        <Icon name="share" size={16} /> {pending ? "Making the card…" : label}
      </Button>
      {state === "copied" && url ? (
        <span className="flex items-center gap-2 text-[13px] text-text-dim" role="status">
          <Icon name="check" size={16} className="text-success" /> Link copied ·
          <a href={url} target="_blank" rel="noreferrer" className="text-text underline-offset-4 hover:underline">
            open the card
          </a>
        </span>
      ) : state === "shown" && url ? (
        <a href={url} target="_blank" rel="noreferrer" className="font-mono text-[13px] text-text underline-offset-4 hover:underline" role="status">
          {url}
        </a>
      ) : state === "error" ? (
        <span className="text-[13px] text-heat" role="status">
          Couldn&apos;t make the card. Try again.
        </span>
      ) : null}
    </span>
  );
}
