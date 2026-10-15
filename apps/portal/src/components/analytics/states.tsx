"use client";
import { Button } from "../ui";

/** Skeleton rows in the dashboard's final layout (never a spinner). */
export function DashboardSkeleton({ tiles = 6, rows = 3 }: { tiles?: number; rows?: number }) {
  return (
    <div className="flex flex-col gap-14" aria-busy="true" aria-label="Loading your numbers">
      <div className="flex items-center gap-6">
        <div className="skeleton size-[72px] rounded-[20px]" />
        <div className="flex flex-1 flex-col gap-3">
          <div className="skeleton h-10 w-[min(360px,70%)] rounded-[8px]" />
          <div className="skeleton h-3 w-48 rounded-[4px]" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-8 border-y border-line py-6 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: tiles }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="skeleton h-3 w-20 rounded-[4px]" />
            <div className="skeleton h-8 w-24 rounded-[6px]" />
          </div>
        ))}
      </div>
      <div className="skeleton h-[220px] w-full rounded-[12px]" />
      <div className="flex flex-col">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="rule-b flex items-center gap-5 py-5">
            <div className="skeleton size-14 rounded-[16px]" />
            <div className="skeleton h-4 w-40 rounded-[4px]" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardError({ reset }: { reset: () => void }) {
  return (
    <div className="rule-t rule-b flex flex-col items-start gap-3 py-12">
      <h2 className="font-wide text-[22px] font-extrabold tracking-tight text-text">The numbers tripped over a cable.</h2>
      <p className="max-w-md text-[15px] leading-6 text-text-dim">Nothing is lost: plays keep counting while this page is down. Try again in a moment.</p>
      <Button type="button" variant="secondary" onClick={reset}>
        Retry
      </Button>
    </div>
  );
}
