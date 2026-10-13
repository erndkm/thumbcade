"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Viewer } from "@/lib/auth";
import { Avatar } from "./avatar";
import { Lockup } from "./brand";
import { Icon } from "./icon";
import { cx } from "./ui";
import type { IconName } from "@thumbcade/design-tokens";

const creatorLinks: { href: string; label: string; icon: IconName }[] = [
  { href: "/creator", label: "Games", icon: "grid" },
  { href: "/creator/tokens", label: "API tokens", icon: "lock" },
  { href: "/docs", label: "Docs", icon: "code" },
];
const adminLinks: { href: string; label: string; icon: IconName }[] = [
  { href: "/admin", label: "Review queue", icon: "eye" },
  { href: "/admin/reports", label: "Reports", icon: "flag" },
  { href: "/admin/editorial", label: "Editorial", icon: "save" },
];

export function AppNav({ viewer }: { viewer: Viewer | null }) {
  const pathname = usePathname() ?? "";
  const isActive = (href: string) => (href === "/creator" || href === "/admin" ? pathname === href || (href === "/creator" && pathname.startsWith("/creator/games")) || (href === "/admin" && pathname.startsWith("/admin/review")) : pathname.startsWith(href));
  const Item = ({ l }: { l: (typeof creatorLinks)[number] }) => (
    <Link
      href={l.href}
      className={cx(
        "flex h-10 items-center gap-3 rounded-[10px] px-3 text-[14px] font-medium transition-colors",
        isActive(l.href) ? "bg-raised text-text" : "text-text-dim hover:bg-raised/60 hover:text-text",
      )}
    >
      <Icon name={l.icon} size={18} active={isActive(l.href)} detailColor="var(--tc-raised)" />
      {l.label}
    </Link>
  );
  return (
    <aside className="border-b border-line lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:border-b-0 lg:border-r">
      <div className="flex h-16 items-center px-5">
        <Lockup height={24} />
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-1 lg:flex-col lg:overflow-visible lg:pb-0">
        <span className="label hidden px-3 pb-2 pt-4 lg:block">Create</span>
        {creatorLinks.map((l) => (
          <Item key={l.href} l={l} />
        ))}
        {viewer?.role === "admin" ? (
          <>
            <span className="label hidden px-3 pb-2 pt-6 lg:block">Moderate</span>
            {adminLinks.map((l) => (
              <Item key={l.href} l={l} />
            ))}
          </>
        ) : null}
      </nav>
      {viewer ? (
        <div className="hidden items-center gap-3 border-t border-line p-4 lg:flex">
          <Avatar url={viewer.avatarUrl} seed={viewer.avatarSeed} size={34} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold text-text">{viewer.displayName}</div>
            <div className="truncate font-mono text-[11px] text-text-mute">@{viewer.handle} · {viewer.role}</div>
          </div>
          <form action="/auth/signout" method="post">
            <button type="submit" className="flex size-8 items-center justify-center rounded-full text-text-mute hover:bg-raised hover:text-text" aria-label="Sign out" title="Sign out">
              <Icon name="forward" size={16} />
            </button>
          </form>
        </div>
      ) : null}
    </aside>
  );
}
