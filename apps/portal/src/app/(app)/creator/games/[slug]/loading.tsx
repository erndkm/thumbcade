import { DashboardSkeleton } from "@/components/analytics/states";

export default function Loading() {
  return <DashboardSkeleton tiles={6} rows={2} />;
}
