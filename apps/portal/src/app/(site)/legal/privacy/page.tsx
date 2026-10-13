import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy" };

export default function Privacy() {
  return (
    <article className="prose-tc mx-auto max-w-[760px] px-4 pt-16">
      <span className="label">Legal</span>
      <h1>Privacy</h1>
      <p>Thumbcade is built so that games never learn who you are. This page explains what we collect and why.</p>
      <h2>What we collect</h2>
      <ul>
        <li><strong>Account</strong>: your email (if you sign in with email), handle, display name, avatar, bio, and an age band — never your date of birth.</li>
        <li><strong>Activity</strong>: which games you see, play, skip, like, save, share and comment on, and your scores. We use it to rank your feed and to show creators aggregate stats.</li>
        <li><strong>Game storage</strong>: small saves (up to 64 KB per game) that games write through the SDK.</li>
        <li><strong>Device</strong>: a push token if you enable notifications.</li>
      </ul>
      <h2>What games see</h2>
      <p>A per-game anonymous player id, your display name and avatar, your best score in that game, and whether sound is on. Games can&apos;t reach the network outside their own origin, can&apos;t read your account, and run without third-party trackers or ad SDKs.</p>
      <h2>What we never do</h2>
      <ul>
        <li>Sell your data or share it with advertisers.</li>
        <li>Store your date of birth or precise location.</li>
      </ul>
      <h2>Your controls</h2>
      <p>Export or delete your account from Settings in the app. Deletion removes your profile, likes, saves, comments, scores and game storage. Questions: <a href="mailto:privacy@thumbcade.com">privacy@thumbcade.com</a>.</p>
    </article>
  );
}
