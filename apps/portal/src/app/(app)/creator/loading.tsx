import { DashboardSkeleton } from "@/components/analytics/states";

export default function Loading() {
  return <DashboardSkeleton tiles={4} rows={3} />;
}
