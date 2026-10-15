import { OPERATOR, RETENTION } from "./operator.ts";
import { facts, list, p, type LegalDoc, type LegalDocId } from "./types.ts";

const UPDATED = "2026-10-14";
const ACCOUNT_URL = "https://thumbcade.com/account";

function operatorLines(): string {
  return [OPERATOR.name, ...OPERATOR.address].join("\n");
}

const imprint: LegalDoc = {
  title: "Imprint",
  updated: UPDATED,
  intro: "Thumbcade (thumbcade.com, thumbcade.gg and the Thumbcade apps) is provided by:",
  sections: [
    {
      heading: "Provider",
      blocks: [p(operatorLines()), ...(OPERATOR.representedBy ? [p(`Represented by ${OPERATOR.representedBy}`)] : [])],
    },
    {
      heading: "Contact",
      blocks: [p([`Email: ${OPERATOR.email.general}`, ...(OPERATOR.phone ? [`Phone: ${OPERATOR.phone}`] : [])].join("\n"))],
    },
    ...(OPERATOR.register || OPERATOR.vatId
      ? [
          {
            heading: "Register",
            blocks: [
              p(
                [
                  ...(OPERATOR.register ? [`Register court: ${OPERATOR.register.court}`, `Register number: ${OPERATOR.register.number}`] : []),
                  ...(OPERATOR.vatId ? [`VAT ID: ${OPERATOR.vatId}`] : []),
                ].join("\n"),
              ),
            ],
          },
        ]
      : []),
    {
      heading: "Digital Services Act contact",
      blocks: [
        p(
          `Single point of contact for authorities, the European Commission and users (Art. 11 and 12 DSA): ${OPERATOR.email.general}. We answer in English and German. To report illegal content, write to ${OPERATOR.email.safety} or use Report in the app.`,
        ),
      ],
    },
  ],
};

const privacy: LegalDoc = {
  title: "Privacy Policy",
  updated: UPDATED,
  intro:
    "Thumbcade is built so that games never learn who you are. No ads, no ad SDKs, no third-party trackers, and we never sell data. This page explains what we do process, why, on which legal basis and for how long.",
  sections: [
    {
      heading: "Who is responsible",
      blocks: [
        p(`The controller under the GDPR is:\n${operatorLines()}`),
        p(`Privacy questions and requests: ${OPERATOR.email.privacy}`),
      ],
    },
    {
      heading: "Using the app and the website",
      blocks: [
        p(
          "When your device talks to our servers, they see its IP address, the time, the address requested and the app or browser version. Our sign-in service also records the IP address and device type of each session.",
        ),
        facts({
          Why: "To deliver the service, keep it secure and investigate abuse.",
          "Legal basis": "Art. 6(1)(f) GDPR (our legitimate interest in running a secure service).",
          Kept: `Request logs are deleted after at most ${RETENTION.serverLogsDays} days. Session records end when you sign out or delete your account.`,
        }),
      ],
    },
    {
      heading: "Playing as a guest",
      blocks: [
        p(
          "The first time you open the app we create a guest account: a random id, the age range from your birth year (we never store the year or your birthday) and the interests you pick. Your settings stay on your device.",
        ),
        facts({
          Why: "So scores, saves and your feed work without signing up, and so we only show games rated for your age.",
          "Legal basis": "Art. 6(1)(b) GDPR (providing the service you asked for); for the age range also Art. 6(1)(c) and (f) GDPR (protecting minors).",
          Kept: `Until you delete it, or automatically after ${RETENTION.inactiveGuestMonths} months without use.`,
        }),
      ],
    },
    {
      heading: "Your account",
      blocks: [
        p(
          "If you sign up: your email address, or the identity Apple or Google send us when you use their sign-in (an id, and your email address and name if you share them), plus your handle, display name, profile photo and bio.",
        ),
        p("Your handle, display name, photo, bio, comments, follows and leaderboard scores are visible to other players."),
        facts({
          Why: "To run your account and the social features.",
          "Legal basis": "Art. 6(1)(b) GDPR.",
          Kept: "Until you delete your account.",
        }),
      ],
    },
    {
      heading: "Playing, scores and game saves",
      blocks: [
        p(
          "For every run: the game, start and end time, active playtime, score and outcome. Your best and daily scores, and the small saves games write for you (up to 64 KB per game).",
        ),
        facts({
          Why: "Leaderboards, challenges, saved progress, and rejecting impossible scores.",
          "Legal basis": "Art. 6(1)(b) GDPR; checking scores for cheating: Art. 6(1)(f) GDPR (fair leaderboards).",
          Kept: "Until you delete your account.",
        }),
      ],
    },
    {
      heading: "Your feed and usage statistics",
      blocks: [
        p(
          "We record what happens in the feed: which games you see, start, finish, replay, skip (and how long you watched first), like, save, share and comment on. From this we keep a weight per hashtag that fades over time.",
        ),
        p(
          "Your feed is ranked automatically from those signals, the games and creators you follow and like, how new a game is and how well it does overall. This personalisation has no legal or similarly significant effect on you.",
        ),
        p("Creators see aggregate numbers about their games (plays, playtime, likes). They never see who played."),
        facts({
          Why: "To build your feed and to give creators and us statistics about how games perform.",
          "Legal basis": "Art. 6(1)(b) GDPR for your feed; Art. 6(1)(f) GDPR for statistics (improving the games and the service).",
          Kept: `Individual events are deleted after ${RETENTION.usageEventsDays} days; after that only daily totals per game remain, which are not linked to you. Hashtag weights are deleted with your account.`,
        }),
      ],
    },
    {
      heading: "Comments, reports and moderation",
      blocks: [
        p(
          "Comments pass an automatic word filter. Reports you send, blocks you set and decisions our moderators take about content are stored. Every report is reviewed by a person.",
        ),
        facts({
          Why: "To keep Thumbcade safe and to meet our legal duties for hosted content.",
          "Legal basis": "Art. 6(1)(b), (c) and (f) GDPR.",
          Kept: "Until you delete your account. Records of decisions about illegal content can be kept longer where the law requires it.",
        }),
      ],
    },
    {
      heading: "Notifications",
      blocks: [
        p(
          "If you allow notifications, we store your device's push token. Messages go through Expo's push service and Apple Push Notification service or Google Firebase Cloud Messaging.",
        ),
        facts({
          "Legal basis": "Art. 6(1)(a) GDPR (your consent). Turn notifications off in Settings or your phone's settings at any time.",
          Kept: "Until you turn notifications off, sign out or delete your account.",
        }),
      ],
    },
    {
      heading: "Creators",
      blocks: [
        p(
          "If you publish games: your games, their builds and store details, review reports, and your API tokens (we store only a hash). Your handle and games are public.",
        ),
        facts({
          "Legal basis": "Art. 6(1)(b) GDPR.",
          Kept: "Until you delete the game or your account.",
        }),
      ],
    },
    {
      heading: "What games see",
      blocks: [
        p(
          "Games run isolated from the app, on their own web address, and can't load anything from other servers. A game gets an anonymous player id that only works inside that game, your display name and photo, your best score in it and whether sound is on. Never your email, your account id or anything from your device.",
        ),
      ],
    },
    {
      heading: "Cookies and storage on your device",
      blocks: [
        p(
          "The website sets only the cookies it needs to keep you signed in. The web player keeps your best scores and game saves in your browser's local storage. The app keeps your settings and sign-in on your phone. All of this is strictly necessary for what you asked for, so there is no cookie banner. We use no analytics or advertising cookies.",
        ),
      ],
    },
    {
      heading: "Who processes data for us",
      blocks: [
        list(
          "Supabase: database, sign-in, file storage and server functions, hosted in the EU.",
          "Cloudflare: delivers game files and images.",
          "Our email provider: sends sign-in codes.",
          "Our website hosting provider.",
          "Expo, Apple and Google: push notifications, only if you enable them.",
        ),
        p(
          "They work on our instructions under data processing agreements. If you choose Sign in with Apple or Google, that company processes your sign-in under its own privacy policy.",
        ),
        p(
          "Some of these companies are based in the US or have US parents. Where data leaves the EU, the transfer relies on the EU–US Data Privacy Framework or on the EU Standard Contractual Clauses.",
        ),
      ],
    },
    {
      heading: "Your rights",
      blocks: [
        p("You have the right to:"),
        list(
          "get a copy of your data (Art. 15 GDPR) and receive it in a machine-readable format (Art. 20)",
          "have wrong data corrected (Art. 16)",
          "have your data deleted (Art. 17) or its processing restricted (Art. 18)",
          "object to processing based on our legitimate interests (Art. 21)",
          "withdraw consent at any time, without affecting earlier processing (Art. 7(3))",
          "lodge a complaint with a data protection supervisory authority (Art. 77)",
        ),
        p(
          `Do it yourself: in the app under Settings → Download my data and Settings → Delete account, or on the web at ${ACCOUNT_URL}. Deletion is immediate. Copies in our backups are overwritten within ${RETENTION.backupsDays} days. For anything else, write to ${OPERATOR.email.privacy}.`,
        ),
      ],
    },
    {
      heading: "Children",
      blocks: [
        p(
          "Under 13s can play games rated for their age but can't create an account, comment or appear on leaderboards. If you are under 16, ask a parent or guardian before you sign up.",
        ),
      ],
    },
    {
      heading: "Do you have to give us data?",
      blocks: [p("No. You can play without signing up. An account needs an email address, or Sign in with Apple or Google.")],
    },
    {
      heading: "Changes",
      blocks: [p("We update this page when our processing changes. If a change matters to you, we tell you in the app.")],
    },
  ],
};

const terms: LegalDoc = {
  title: "Terms of Service",
  updated: UPDATED,
  intro: `These terms apply to Thumbcade, its apps and thumbcade.com, provided by ${OPERATOR.name} (see Imprint). Thumbcade is free. Play fair, be decent to people, and don't try to break the arcade for everyone else.`,
  sections: [
    {
      heading: "Your account",
      blocks: [
        p("You can play without an account. If you sign up, keep your login to yourself; you're responsible for what happens under your handle."),
        p(
          "You must be at least 13 to create an account, like, comment, follow or appear on leaderboards. If you are under 16, you need a parent's or guardian's permission. Younger players can play games rated for their age.",
        ),
      ],
    },
    {
      heading: "Games",
      blocks: [
        p(
          "Games are made by independent creators. We review every build before it goes live; games run isolated, with no access to your device beyond sound, touch and the score and storage services we provide.",
        ),
      ],
    },
    {
      heading: "What you post",
      blocks: [
        p(
          "Comments and profile details stay yours, but you allow us to show them inside Thumbcade. Don't post anything illegal, hateful, sexual, harassing or that you don't have the rights to. The community guidelines spell out the rest.",
        ),
      ],
    },
    {
      heading: "Creators",
      blocks: [
        list(
          "You own your games. You allow us to host, review, display and distribute them in the app and on thumbcade.com while they are published.",
          "Your game is original or properly licensed, collects no personal data, and follows the review guidelines at https://thumbcade.com/docs/review.",
          "We can reject or remove games that break these terms, and we tell you why. To take one of your games down, write to us.",
        ),
      ],
    },
    {
      heading: "How we moderate",
      blocks: [
        list(
          "Automatic checks: a word filter on comments, plausibility checks on every score, and automated tests of every game build.",
          "People: every game build and every report is reviewed by a person before we act on it.",
          "What we can do: hide comments, reject scores, remove games, and suspend or close accounts that break these terms or the guidelines. Repeat or serious breaches lose the account.",
        ),
        p(`If you think we got a decision wrong, write to ${OPERATOR.email.safety}. A person looks at it again.`),
      ],
    },
    {
      heading: "Reporting illegal content",
      blocks: [
        p(
          `Use Report on any comment, profile or game. Without an account, email ${OPERATOR.email.safety} with the link to the content, why you believe it is illegal, and your name and email address. We confirm that we received it and tell you what we decided.`,
        ),
      ],
    },
    {
      heading: "Leaving",
      blocks: [
        p(
          "Delete your account any time in Settings or at https://thumbcade.com/account. It removes your profile and everything tied to it, including your games. We may close accounts that seriously or repeatedly break these terms.",
        ),
      ],
    },
    {
      heading: "Changes",
      blocks: [p("We may change Thumbcade and these terms. If a change affects you, we tell you in the app before it applies.")],
    },
    {
      heading: "Contact",
      blocks: [p(`${OPERATOR.email.general} · safety issues: ${OPERATOR.email.safety}`)],
    },
  ],
};

const guidelines: LegalDoc = {
  title: "Community guidelines",
  updated: UPDATED,
  sections: [
    {
      heading: "Trash talk the score, not the person",
      blocks: [p("Rivalries are the point. Harassment, slurs, threats and pile-ons are not. A word filter catches the obvious stuff; humans handle the rest.")],
    },
    {
      heading: "Keep it for everyone",
      blocks: [p("No sexual content, gore or self-harm content in comments, avatars or games. Games must match their age rating.")],
    },
    {
      heading: "Play it straight",
      blocks: [p("No score exploits, bots or modified clients. If a game is broken, report it so the creator can fix it.")],
    },
    {
      heading: "Report and block",
      blocks: [p("Long-press a comment, or open a profile or a game's menu, to report or block. Reports are private and every one is reviewed.")],
    },
    {
      heading: "Creators",
      blocks: [p("Only publish games you made or have the rights to. Don't copy other games' names, art or trademarks. Reviewed builds are exactly what players run.")],
    },
  ],
};

export const LEGAL_DOCS: Record<LegalDocId, LegalDoc> = { imprint, privacy, terms, guidelines };
