import Link from "next/link";
import type { ReactNode } from "react";
import { AppNav } from "@/components/app-nav";
import { getViewer } from "@/lib/auth";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewer();
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <AppNav viewer={viewer} />
      <main className="min-w-0 px-4 pb-10 pt-8 md:px-10 lg:pt-12">
        {children}
        <footer className="mt-24 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-text-mute">
          <Link href="/legal/imprint" className="hover:text-text">Imprint</Link>
          <Link href="/legal/privacy" className="hover:text-text">Privacy</Link>
          <Link href="/legal/terms" className="hover:text-text">Terms</Link>
        </footer>
      </main>
    </div>
  );
}
