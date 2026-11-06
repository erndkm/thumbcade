import type { Metadata } from "next";
import { noticeText, notices, type ThirdPartyNotice } from "@/lib/notices.generated";

export const metadata: Metadata = {
  title: "Open-source licences",
  description: "The open-source packages and fonts the Thumbcade website is built with, with their licence and copyright notices.",
};

const FALLBACK: Record<NonNullable<ThirdPartyNotice["fallback"]>, string> = {
  readme: "with the copyright notice from its README",
  source: "with the copyright notice from its source files",
  author: "with the author named in its package details",
  none: "it names no copyright holder",
};

const label = (n: ThirdPartyNotice) => (n.version ? `${n.name} ${n.version}` : `${n.name} (${n.note})`);

/** Third-party notices for the website, generated from the lockfile (`pnpm --filter @thumbcade/portal notices`). */
export default function Licenses() {
  const fonts = notices.filter((n) => n.kind === "font");
  const packages = notices.filter((n) => n.kind !== "font");
  // Each distinct text is printed once, with every package that ships exactly that text.
  const texts = new Map<number, { file: string; users: ThirdPartyNotice[] }>();
  for (const n of notices) {
    for (const f of n.files) {
      const t = texts.get(f.text) ?? { file: f.name, users: [] };
      t.users.push(n);
      texts.set(f.text, t);
    }
  }
  return (
    <article className="prose-tc mx-auto max-w-[760px] px-4 pt-16">
      <span className="label">Legal</span>
      <h1>Open-source licences</h1>
      <p>
        The Thumbcade website is built with open-source software. Below are the {packages.length} packages it is made of (its production dependencies, including the code Next.js bundles) and the {fonts.length} fonts it uses, each
        with the licence and copyright notices it comes with. The app lists its own under Settings → Open-source licences, and every game ships the libraries bundled into it in its <code>licenses/</code> folder.
      </p>

      <h2>Fonts</h2>
      <ul>
        {fonts.map((f) => (
          <li key={f.name}>
            <strong>{f.name}</strong> {f.version} · {f.license} · <a href={`#text-${f.files[0]!.text}`}>Licence text</a> · <a href={`/licenses/${f.files[0]!.name}`}>{f.files[0]!.name}</a>
          </li>
        ))}
      </ul>

      <h2>Packages</h2>
      <p>
        Each name links to its licence text. An asterisk marks a package that ships no licence file of its own: it is shown with the standard text of the licence it declares.
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Package</th>
            <th scope="col">Version</th>
            <th scope="col">Licence</th>
          </tr>
        </thead>
        <tbody>
          {packages.map((n) => (
            <tr key={`${n.name}@${n.version}#${n.note ?? ""}`}>
              <td>
                <a href={`#text-${n.files[0]!.text}`}>{n.name}</a>
                {n.files.slice(1).map((f) => (
                  <span key={f.name}>
                    {" · "}
                    <a href={`#text-${f.text}`}>{f.name}</a>
                  </span>
                ))}
              </td>
              <td className="font-mono text-[13px]">{n.version || <span className="text-text-mute">{n.note}</span>}</td>
              <td className="font-mono text-[13px]">
                {n.license}
                {n.fallback ? <abbr title={`No licence file shipped: standard text, ${FALLBACK[n.fallback]}`}>*</abbr> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Licence texts</h2>
      {[...texts].map(([id, t]) => (
        <section key={id} id={`text-${id}`}>
          <h3>
            {t.users[0]!.name}
            {t.users.length > 1 ? ` and ${t.users.length - 1} more` : ""}
          </h3>
          <p className="text-[14px]">
            {t.file} of {t.users.map(label).join(", ")}
            {t.users.some((u) => u.fallback) ? ". Standard licence text: the package ships no licence file." : "."}
          </p>
          <pre className="whitespace-pre-wrap [overflow-wrap:anywhere]">{noticeText(id)}</pre>
        </section>
      ))}
    </article>
  );
}
