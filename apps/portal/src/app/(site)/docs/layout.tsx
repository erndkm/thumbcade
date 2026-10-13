import type { ReactNode } from "react";
import { DocsNav } from "@/components/docs-nav";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-[1280px] gap-12 px-4 pt-12 md:px-8 lg:grid-cols-[220px_minmax(0,760px)] lg:gap-20">
      <DocsNav />
      <article className="prose-tc min-w-0 pb-16">{children}</article>
    </div>
  );
}
