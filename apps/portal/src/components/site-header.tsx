import Link from "next/link";
import { getViewer } from "@/lib/auth";
import { Avatar } from "./avatar";
import { Lockup } from "./brand";
import { ButtonLink } from "./ui";

export async function SiteHeader() {
  const viewer = await getViewer();
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/80 backdrop-blur-md supports-[backdrop-filter]:bg-bg/70">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-8 px-4 md:px-8">
        <Lockup height={26} />
        <nav className="hidden items-center gap-6 text-[14px] font-medium text-text-dim md:flex">
          <Link href="/#play" className="transition-colors hover:text-text">Play</Link>
          <Link href="/#swipe-contract" className="transition-colors hover:text-text">How it works</Link>
          <Link href="/#creators" className="transition-colors hover:text-text">Build a game</Link>
          <Link href="/docs" className="transition-colors hover:text-text">Docs</Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {viewer ? (
            <Link href={viewer.role === "admin" ? "/admin" : "/creator"} className="flex items-center gap-2 rounded-pill py-1 pl-1 pr-3 text-[14px] text-text-dim transition-colors hover:bg-raised hover:text-text">
              <Avatar url={viewer.avatarUrl} seed={viewer.avatarSeed} size={28} />
              <span className="hidden sm:inline">@{viewer.handle}</span>
            </Link>
          ) : (
            <Link href="/login" className="hidden text-[14px] font-medium text-text-dim transition-colors hover:text-text sm:inline">Sign in</Link>
          )}
          <ButtonLink href="/#get" size="sm">Get the app</ButtonLink>
        </div>
      </div>
    </header>
  );
}
