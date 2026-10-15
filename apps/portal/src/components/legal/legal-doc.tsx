import { formatLegalDate, splitLinks, type LegalBlock, type LegalDoc } from "@thumbcade/legal";

/** Renders a shared legal document (@thumbcade/legal); the app renders the same data natively. */
export function LegalDocView({ doc }: { doc: LegalDoc }) {
  return (
    <article className="prose-tc mx-auto max-w-[760px] px-4 pt-16">
      <span className="label">Legal · updated {formatLegalDate(doc.updated)}</span>
      <h1>{doc.title}</h1>
      {doc.intro ? (
        <p>
          <Linked text={doc.intro} />
        </p>
      ) : null}
      {doc.sections.map((s) => (
        <section key={s.heading}>
          <h2>{s.heading}</h2>
          {s.blocks.map((b, i) => (
            <Block key={i} block={b} />
          ))}
        </section>
      ))}
    </article>
  );
}

function Block({ block }: { block: LegalBlock }) {
  if (block.kind === "p")
    return (
      <p className="whitespace-pre-line">
        <Linked text={block.text} />
      </p>
    );
  if (block.kind === "list")
    return (
      <ul>
        {block.items.map((item) => (
          <li key={item}>
            <Linked text={item} />
          </li>
        ))}
      </ul>
    );
  return (
    <dl className="mb-[18px] flex flex-col gap-3 border-l-2 border-line pl-4">
      {block.items.map((f) => (
        <div key={f.label}>
          <dt className="label">{f.label}</dt>
          <dd className="mt-1">
            <Linked text={f.text} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Linked({ text }: { text: string }) {
  return splitLinks(text).map((seg, i) => (seg.href ? <a key={i} href={seg.href}>{seg.text}</a> : seg.text));
}
