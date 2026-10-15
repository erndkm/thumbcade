"use client";
import { DashboardError } from "@/components/analytics/states";

export default function CreatorError({ reset }: { error: Error; reset: () => void }) {
  return <DashboardError reset={reset} />;
}
