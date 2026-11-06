import { OPERATOR } from "@thumbcade/legal";
import Link from "next/link";
import { Lockup } from "./brand";

const cols = [
  { title: "Play", links: [["The feed", "/#play"], ["How swiping works", "/#swipe-contract"], ["Get the app", "/#get"]] },
  { title: "Build", links: [["Quickstart", "/docs"], ["SDK reference", "/docs/sdk"], ["Swipe Contract", "/docs/swipe-contract"], ["Review guidelines", "/docs/review"]] },
  { title: "Creators", links: [["Dashboard", "/creator"], ["API tokens", "/creator/tokens"], ["Manifest schema", "/schema/manifest-v1.json"]] },
  { title: "Company", links: [["Imprint", "/legal/imprint"], ["Privacy", "/legal/privacy"], ["Terms", "/legal/terms"], ["Licences", "/licenses"], ["Guidelines", "/legal/guidelines"], ["Report a problem", `mailto:${OPERATOR.email.safety}`]] },
] as const;

export function SiteFooter() {
  return (
    <footer className="mt-32 border-t border-line">
      <div className="mx-auto grid max-w-[1280px] gap-12 px-4 py-16 md:grid-cols-[1.4fr_repeat(4,1fr)] md:px-8">
        <div className="flex flex-col gap-4">
          <Lockup height={24} />
          <p className="max-w-[260px] text-[14px] leading-6 text-text-mute">An infinite feed of games you can play in one thumb. Made by people who build them.</p>
        </div>
        {cols.map((c) => (
          <div key={c.title} className="flex flex-col gap-3">
            <span className="label">{c.title}</span>
            {c.links.map(([label, href]) => (
              <Link key={href} href={href} className="text-[14px] text-text-dim transition-colors hover:text-text">
                {label}
              </Link>
            ))}
          </div>
        ))}
      </div>
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-4 border-t border-line px-4 py-6 md:px-8">
        <span className="label">© {new Date().getFullYear()} Thumbcade</span>
        <span className="label">Games are served from thumbcade.gg · one origin per game</span>
      </div>
    </footer>
  );
}
