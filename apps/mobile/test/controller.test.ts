import type { LaunchContext } from "@thumbcade/protocol";
import { CHANNEL } from "@thumbcade/protocol";
import { injectionFor } from "../src/feed/controller";
import { GAME_ID, VERSION_ID, boot, harness } from "./helpers";

describe("CardController bridge", () => {
  it("answers hello with a LaunchContext reply and never exposes the real user", async () => {
    const h = harness();
    h.ctl.loadStarted();
    h.game("hello", { sdkVersion: "1.2.0" }, "hello1");
    await h.flush();
    const reply = h.sent.find((m) => m.type === "reply");
    expect(reply?.replyTo).toBe("hello1");
    const ctx = (reply!.payload as { ok: true; result: LaunchContext }).result;
    expect(ctx.gameId).toBe(GAME_ID);
    expect(ctx.player?.id).toMatch(/^p_/);
    expect(ctx.audio.muted).toBe(true);
    expect(ctx.insets.current).toBe("preview");
    expect(ctx.insets.preview.right).toBe(72);
    expect(ctx.launchReason).toBe("feed");
  });

  it("rejects unsupported SDK majors and fails the card", async () => {
    const h = harness();
    h.ctl.loadStarted();
    h.ctl.activate();
    h.game("hello", { sdkVersion: "7.0.0" }, "hello1");
    await h.flush();
    const reply = h.sent.find((m) => m.type === "reply")!;
    expect((reply.payload as { ok: boolean }).ok).toBe(false);
    expect(h.ctl.getSnapshot().phase).toBe("FAILED");
  });

  it("drops malformed and unknown messages", () => {
    const h = harness();
    h.ctl.onMessage("{nope");
    h.ctl.onMessage(JSON.stringify({ ch: CHANNEL, v: 1, id: "x", type: "camera.open" }));
    h.game("gameplay.end", { score: "lots" });
    expect(h.sent).toHaveLength(0);
    expect(h.ctl.getSnapshot().phase).toBe("OFFSCREEN");
  });

  it("goes LOADING -> PREVIEW on ready and tracks impression + ready", async () => {
    const h = harness();
    await boot(h);
    expect(h.ctl.getSnapshot().phase).toBe("PREVIEW");
    expect(h.tracked.map((e) => e.type)).toEqual(expect.arrayContaining(["impression", "ready"]));
  });

  it("pauses a preloaded OFFSCREEN card as soon as it is ready", async () => {
    const h = harness();
    await boot(h, false);
    expect(h.sent.filter((m) => m.type === "pause")).toEqual([expect.objectContaining({ payload: { reason: "offscreen" } })]);
    h.ctl.activate();
    expect(h.sent.at(-1)?.type).toBe("resume");
  });

  it("starts a run on gameplay.start, opens a session, and switches insets to play", async () => {
    const h = harness();
    await boot(h);
    h.game("gameplay.start", { trigger: "tap" });
    expect(h.ctl.getSnapshot().phase).toBe("PLAYING");
    expect(h.deps.sessionStart).toHaveBeenCalledWith({ gameId: GAME_ID, versionId: VERSION_ID, launchReason: "feed" });
    const insets = h.sent.filter((m) => m.type === "insets").at(-1);
    expect((insets?.payload as { current: string }).current).toBe("play");
  });

  it("ends a run, shows the score immediately and refines it from session-end", async () => {
    const h = harness({ best: 100 });
    await boot(h);
    h.game("gameplay.start", { trigger: "tap" });
    h.now.t += 30_000;
    h.game("gameplay.end", { score: 120, outcome: "lose" });
    expect(h.ctl.getSnapshot().phase).toBe("ENDED");
    expect(h.ctl.getSnapshot().result).toMatchObject({ score: 120, pending: true, isNewBest: true });
    await h.flush();
    await h.flush();
    expect(h.deps.sessionEnd).toHaveBeenCalledWith(expect.objectContaining({ score: 120, durationMs: 30_000, outcome: "lose" }));
    expect(h.ctl.getSnapshot().result).toMatchObject({ pending: false, percentile: 91, dailyRank: 3, isNewBest: true });
    expect(h.tracked).toContainEqual(expect.objectContaining({ type: "play_end", score: 120, durationMs: 30_000 }));
  });

  it("does not stamp NEW BEST on a first-ever run", async () => {
    const h = harness({ best: null });
    await boot(h);
    h.game("gameplay.start", { trigger: "tap" });
    h.game("gameplay.end", { score: 42 });
    await h.flush();
    await h.flush();
    expect(h.ctl.getSnapshot().result).toMatchObject({ score: 42, isNewBest: false, best: 120 });
  });

  it("sends input.cancel then pause when the feed claims a gesture, and resume on spring-back", async () => {
    const h = harness();
    await boot(h);
    h.sent.length = 0;
    h.ctl.dispatch({ type: "FEED_GESTURE_BEGIN" });
    expect(h.sent.map((m) => m.type)).toEqual(["input.cancel", "pause"]);
    h.ctl.dispatch({ type: "FEED_GESTURE_END", committed: false });
    expect(h.sent.at(-1)?.type).toBe("resume");
  });

  it("on a committed swipe the old card is deactivated without a resume in between", async () => {
    const h = harness();
    await boot(h);
    h.sent.length = 0;
    h.ctl.dispatch({ type: "FEED_GESTURE_BEGIN" });
    h.ctl.dispatch({ type: "FEED_GESTURE_END", committed: true });
    h.ctl.deactivate();
    expect(h.sent.map((m) => m.type)).toEqual(["input.cancel", "pause"]);
    expect(h.tracked.at(-1)).toMatchObject({ type: "skip", state: "PREVIEW" });
  });

  it("auto-pauses after 20 s without a touch in PLAYING and resumes on request", async () => {
    const h = harness();
    await boot(h);
    h.game("gameplay.start", { trigger: "tap" });
    h.advance(19_000);
    h.ctl.markActivity();
    h.advance(19_000);
    expect(h.ctl.getSnapshot().phase).toBe("PLAYING");
    h.advance(1_500);
    expect(h.ctl.getSnapshot().phase).toBe("PAUSED");
    expect(h.sent.filter((m) => m.type === "pause").at(-1)?.payload).toEqual({ reason: "idle" });
    h.ctl.resumePlay();
    expect(h.ctl.getSnapshot().phase).toBe("PLAYING");
  });

  it("fails the card when ready() does not arrive within 8 s, and the retry reloads", () => {
    const h = harness();
    h.ctl.loadStarted();
    h.ctl.activate();
    h.advance(8_001);
    expect(h.ctl.getSnapshot().phase).toBe("FAILED");
    expect(h.tracked).toContainEqual(expect.objectContaining({ type: "load_failed" }));
    const key = h.ctl.getSnapshot().loadKey;
    h.ctl.retry();
    expect(h.ctl.getSnapshot().phase).toBe("LOADING");
    expect(h.ctl.getSnapshot().loadKey).toBe(key + 1);
  });

  it("does not count load time while the hosting screen is hidden", () => {
    const h = harness();
    h.ctl.loadStarted();
    h.ctl.activate();
    h.advance(3_000);
    h.ctl.setHostVisible(false);
    h.advance(60_000);
    expect(h.ctl.getSnapshot().phase).toBe("LOADING");
    h.ctl.setHostVisible(true);
    h.advance(4_000);
    expect(h.ctl.getSnapshot().phase).toBe("LOADING");
    h.advance(1_500);
    expect(h.ctl.getSnapshot().phase).toBe("FAILED");
  });

  it("rate-limits storage.set and answers with rate_limited", async () => {
    const h = harness();
    await boot(h);
    for (let i = 0; i < 11; i++) h.game("storage.set", { key: "best", value: i }, `s${i}`);
    await h.flush();
    const replies = h.sent.filter((m) => m.type === "reply" && m.replyTo?.startsWith("s"));
    expect(replies).toHaveLength(11);
    const limited = replies.filter((r) => (r.payload as { ok: boolean }).ok === false);
    expect(limited).toHaveLength(1);
    expect((limited[0]!.payload as { error: { code: string } }).error.code).toBe("rate_limited");
  });

  it("serves storage.get through the injected store", async () => {
    const h = harness();
    await boot(h);
    h.game("storage.get", { key: "best" }, "q1");
    await h.flush();
    const r = h.sent.find((m) => m.replyTo === "q1")!;
    expect(r.payload).toEqual({ ok: true, result: { value: { best: 3 } } });
  });

  it("only maps feedback to haptics while the card is the running card", async () => {
    const h = harness();
    await boot(h, false);
    h.game("feedback", { kind: "impact" });
    expect(h.deps.feedback).not.toHaveBeenCalled();
    h.ctl.activate();
    h.game("feedback", { kind: "impact" });
    expect(h.deps.feedback).toHaveBeenCalledWith("impact");
  });

  it("reports a run started by a swipe as a contract violation", async () => {
    const h = harness();
    const violations: string[] = [];
    h.deps.onViolation = (code) => violations.push(code);
    await boot(h);
    h.game("gameplay.start", { trigger: "swipe" });
    expect(violations).toEqual(["start_by_swipe"]);
  });

  it("replays from the result card", async () => {
    const h = harness();
    await boot(h);
    h.game("gameplay.start", { trigger: "tap" });
    h.game("gameplay.end", { score: 5 });
    h.ctl.replay();
    expect(h.sent.at(-1)?.type).toBe("replay");
    h.game("gameplay.start", { trigger: "tap" });
    expect(h.ctl.getSnapshot().phase).toBe("PLAYING");
    expect(h.ctl.getSnapshot().runs).toBe(2);
  });
});

describe("injectionFor", () => {
  it("dispatches a MessageEvent with the envelope and escapes JS line separators", () => {
    const js = injectionFor({ type: "pause", payload: { text: `a${String.fromCharCode(0x2028)}b` } });
    expect(js.startsWith('window.dispatchEvent(new MessageEvent("message",{data:')).toBe(true);
    expect(js).not.toContain(String.fromCharCode(0x2028));
    expect(js).toContain("\\u2028");
  });
});
