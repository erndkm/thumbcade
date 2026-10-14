import { rewriteLocalUrl } from "../src/lib/env";
import { ageBandFor } from "../src/lib/age";
import { EventQueue } from "../src/lib/eventQueue";
import { insetsFor } from "../src/feed/layout";
import { percentileLine } from "../src/feed/ResultCard";
import { parseDevTarget } from "../src/features/dev/devGame";
import { fmtScore } from "../src/lib/format";
import { isFromOrigin, versionBaseOf } from "../src/feed/GameFrame";

describe("rewriteLocalUrl", () => {
  it("maps loopback hosts to the emulator alias on Android in dev", () => {
    expect(rewriteLocalUrl("http://127.0.0.1:54321/rest/v1", { os: "android", dev: true })).toBe("http://10.0.2.2:54321/rest/v1");
    expect(rewriteLocalUrl("http://localhost:5555/snek/v1/index.html", { os: "android", dev: true })).toBe("http://10.0.2.2:5555/snek/v1/index.html");
  });
  it("leaves iOS, production builds and real hosts alone", () => {
    expect(rewriteLocalUrl("http://127.0.0.1:54321", { os: "ios", dev: true })).toBe("http://127.0.0.1:54321");
    expect(rewriteLocalUrl("http://127.0.0.1:54321", { os: "android", dev: false })).toBe("http://127.0.0.1:54321");
    expect(rewriteLocalUrl("https://snek.thumbcade.gg/v1/index.html", { os: "android", dev: true })).toBe("https://snek.thumbcade.gg/v1/index.html");
  });
});

describe("ageBandFor", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  it("uses the protective lower bound of the age", () => {
    expect(ageBandFor(2013, now)).toBe("under13"); // 12 or 13
    expect(ageBandFor(2012, now)).toBe("13to15");
    expect(ageBandFor(2010, now)).toBe("13to15"); // 15 or 16
    expect(ageBandFor(2009, now)).toBe("16to17");
    expect(ageBandFor(2008, now)).toBe("16to17"); // 17 or 18
    expect(ageBandFor(2007, now)).toBe("adult");
  });
  it("rejects nonsense years", () => {
    expect(ageBandFor(1800, now)).toBeNull();
    expect(ageBandFor(2030, now)).toBeNull();
    expect(ageBandFor(Number.NaN, now)).toBeNull();
  });
});

describe("EventQueue", () => {
  it("batches, flushes and keeps events when sending fails", async () => {
    const sent: number[] = [];
    let fail = true;
    const saved: unknown[][] = [];
    const q = new EventQueue({
      send: async (batch) => {
        if (fail) throw new Error("offline");
        sent.push(batch.length);
      },
      save: (e) => saved.push(e),
      now: () => 42,
    });
    for (let i = 0; i < 250; i++) q.track({ type: "impression" });
    expect(await q.flush()).toBe(0);
    expect(q.size).toBe(250);
    fail = false;
    expect(await q.flush()).toBe(250);
    expect(sent).toEqual([200, 50]);
    expect(q.size).toBe(0);
    expect(saved.at(-1)).toEqual([]);
  });
  it("is bounded", () => {
    const q = new EventQueue({ send: async () => undefined });
    for (let i = 0; i < EventQueue.MAX + 10; i++) q.track({ type: "impression" });
    expect(q.size).toBe(EventQueue.MAX);
  });
});

describe("insets", () => {
  it("covers the top tabs, rail and caption in preview and only the status bar in play", () => {
    const i = insetsFor({ safeTop: 59 });
    expect(i.preview).toEqual({ top: 103, right: 72, bottom: 148, left: 0 });
    expect(i.play).toEqual({ top: 59, right: 0, bottom: 0, left: 0 });
  });
});

describe("copy helpers", () => {
  it("phrases percentiles with a voice", () => {
    expect(percentileLine(null)).toBeNull();
    expect(percentileLine(97.4)).toBe("Top 3% today");
    expect(percentileLine(99.9)).toBe("Top 1% today");
    expect(percentileLine(40)).toBe("Beat 40% today");
    expect(percentileLine(1)).toBe("Room to climb");
  });
  it("formats scores from loose DB configs", () => {
    expect(fmtScore(9842)).toBe("9,842");
    expect(fmtScore(12345, { format: "ms" })).toBe("12.35s");
    expect(fmtScore(120, { unit: "m" })).toBe("120m");
  });
});

describe("developer targets", () => {
  it("accepts LAN URLs and thumbcade://dev links", () => {
    expect(parseDevTarget("http://192.168.1.20:5173/")).toBe("http://192.168.1.20:5173/");
    expect(parseDevTarget(`thumbcade://dev?url=${encodeURIComponent("http://10.0.0.5:5173/")}`)).toBe("http://10.0.0.5:5173/");
    expect(parseDevTarget("javascript:alert(1)")).toBeNull();
    expect(parseDevTarget("not a url")).toBeNull();
  });
  it("derives the version base path the WebView is locked to", () => {
    expect(versionBaseOf("http://127.0.0.1:5555/snek/v1/index.html")).toBe("http://127.0.0.1:5555/snek/v1/");
  });
});

describe("isFromOrigin", () => {
  const origin = "https://snek.thumbcade.gg";
  it("accepts the page URL (iOS) and the bare origin (Android WebMessageListener)", () => {
    expect(isFromOrigin("https://snek.thumbcade.gg/v1/index.html", origin)).toBe(true);
    expect(isFromOrigin("https://snek.thumbcade.gg", origin)).toBe(true);
  });
  it("rejects lookalike hosts and other origins", () => {
    expect(isFromOrigin("https://snek.thumbcade.gg.evil.example/x", origin)).toBe(false);
    expect(isFromOrigin("https://snek.thumbcade.gg.evil.example", origin)).toBe(false);
    expect(isFromOrigin("https://snek.thumbcade.gg:8443/v1/", origin)).toBe(false);
    expect(isFromOrigin("about:blank", origin)).toBe(false);
  });
});
