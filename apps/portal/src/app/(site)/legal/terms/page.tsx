import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms" };

export default function Terms() {
  return (
    <article className="prose-tc mx-auto max-w-[760px] px-4 pt-16">
      <span className="label">Legal</span>
      <h1>Terms</h1>
      <h2>Playing</h2>
      <p>Be decent. No harassment, hate, spam or impersonation in comments or profiles. Report anything that crosses the line from the ··· menu — we review every report.</p>
      <h2>Creating</h2>
      <ul>
        <li>You own your games. You give Thumbcade a license to host, display and distribute them in the feed and on thumbcade.com.</li>
        <li>Your game is original or properly licensed, collects no personal data, and follows the <a href="/docs/review">review guidelines</a>.</li>
        <li>We can remove games that break these terms, with a note that explains why.</li>
      </ul>
      <h2>Contact</h2>
      <p><a href="mailto:hello@thumbcade.com">hello@thumbcade.com</a> · safety issues: <a href="mailto:safety@thumbcade.com">safety@thumbcade.com</a></p>
    </article>
  );
}
