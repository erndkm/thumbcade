import type { ReactNode } from "react";
import { AppNav } from "@/components/app-nav";
import { getViewer } from "@/lib/auth";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewer();
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <AppNav viewer={viewer} />
      <main className="min-w-0 px-4 pb-24 pt-8 md:px-10 lg:pt-12">{children}</main>
    </div>
  );
}
