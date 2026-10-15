"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const sections = [
  { title: "Start", items: [["Quickstart", "/docs"], ["The CLI", "/docs/cli"]] },
  { title: "Reference", items: [["SDK", "/docs/sdk"], ["Manifest", "/docs/manifest"], ["Budgets", "/docs/budgets"], ["How we count players", "/docs/analytics"]] },
  { title: "Guides", items: [["The Swipe Contract", "/docs/swipe-contract"], ["Designing for the feed", "/docs/design"], ["Review guidelines", "/docs/review"]] },
] as const;

export function DocsNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-8 lg:sticky lg:top-24 lg:self-start" aria-label="Docs">
      {sections.map((s) => (
        <div key={s.title} className="flex flex-col gap-1">
          <span className="label mb-2">{s.title}</span>
          {s.items.map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className={`-ml-3 rounded-[8px] px-3 py-1.5 text-[14px] transition-colors ${pathname === href ? "bg-raised font-semibold text-text" : "text-text-dim hover:text-text"}`}
            >
              {label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
