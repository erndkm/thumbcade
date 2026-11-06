import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkBundle, imageSize, initialFiles, obfuscationSign, readBundle, staticScan } from "../src/checks/index.ts";
import { bundle, fakeJpeg, fakePng, MANIFEST } from "./fixtures.ts";

const check = async (files: Parameters<typeof bundle>[0]) => checkBundle(await bundle(files));
const messages = (r: Awaited<ReturnType<typeof checkBundle>>, id: string) => r.checks.find((c) => c.id === id)!.findings.map((f) => `${f.status}:${f.message}`);

describe("checkBundle", () => {
  it("passes a well-formed bundle and measures the first load", async () => {
    const r = await check({});
    expect(r.passed).toBe(true);
    expect(r.checks.map((c) => c.status)).toEqual(["pass", "pass", "pass"]);
    expect(r.totals.initialFiles.sort()).toEqual(["assets/chunk.js", "assets/main.js", "index.html"]);
    expect(r.totals.files).toBe(6);
  });

  it("reports manifest problems with fixes", async () => {
    const r = await check({ "thumbcade.json": JSON.stringify({ ...MANIFEST, id: "Bad Id!", tags: [] }) });
    expect(r.passed).toBe(false);
    const manifest = r.checks.find((c) => c.id === "manifest")!;
    expect(manifest.status).toBe("fail");
    expect(manifest.findings.some((f) => f.message.startsWith("id:") && f.fix?.toLowerCase().includes("lowercase"))).toBe(true);
    expect(manifest.findings.some((f) => f.message.startsWith("tags:"))).toBe(true);
  });

  it("fails a missing manifest, entry or icon, and a wrongly sized icon", async () => {
    expect((await check({ "thumbcade.json": null })).passed).toBe(false);
    expect(messages(await check({ "index.html": null }), "manifest")).toContain("fail:Entry index.html is not in the bundle");
    expect(messages(await check({ "assets/icon.png": null }), "manifest")).toContain("fail:Icon assets/icon.png is not in the bundle");
    expect(messages(await check({ "assets/icon.png": fakePng(512, 512) }), "manifest")).toContain("fail:Icon is 512×512, needs 1024×1024");
  });

  it("checks a declared poster", async () => {
    const withPoster = JSON.stringify({ ...MANIFEST, poster: "assets/poster.jpg" });
    expect((await check({ "thumbcade.json": withPoster, "assets/poster.jpg": fakeJpeg(1080, 1920) })).passed).toBe(true);
    const odd = await check({ "thumbcade.json": withPoster, "assets/poster.jpg": fakeJpeg(720, 1280) });
    expect(messages(odd, "manifest")[0]).toMatch(/^warn:Poster is 720×1280/);
  });

  it("fails files that aren't web code, data or media, and native programs under any name", async () => {
    const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]), Buffer.alloc(64)]);
    const r = await check({ "tools/setup.exe": "MZ", "assets/payload.zip": "PK", "assets/.env": "SECRET=1", "assets/level.bin": elf });
    expect(r.passed).toBe(false);
    expect(messages(r, "manifest")).toEqual([
      "fail:assets/.env: hidden files are not allowed",
      "fail:assets/level.bin is a Linux (ELF) executable",
      "fail:assets/payload.zip: .zip files are not allowed",
      "fail:tools/setup.exe: .exe files are not allowed",
    ]);
  });

  it("leaves out files the OS drops into folders", async () => {
    const r = await check({ ".DS_Store": "x", "assets/Thumbs.db": "x" });
    expect(r.passed).toBe(true);
    expect(r.totals.files).toBe(6);
  });

  it("fails an initial payload over 3 MB gzipped, but not a lazily loaded asset", async () => {
    const big = randomBytes(3.2 * 1024 * 1024).toString("base64");
    const eager = await check({ "assets/chunk.js": `export const blob = "${big}";` });
    expect(eager.checks.find((c) => c.id === "size")!.status).toBe("fail");
    const lazy = await check({ "assets/later.js": `export const blob = "${big}";` });
    expect(lazy.checks.find((c) => c.id === "size")!.status).toBe("pass");
  });
});

describe("staticScan", () => {
  const scan = async (files: Parameters<typeof bundle>[0]) => staticScan(await readBundle(await bundle(files)));

  it("fails inline scripts, remote loads and root-relative paths in HTML", async () => {
    const f = await scan({
      "index.html": `<html><head><meta name="viewport" content="width=device-width"><script>alert(1)</script><script src="https://cdn.example.com/x.js"></script><link rel="stylesheet" href="/assets/app.css"></head></html>`,
    });
    expect(f.map((x) => `${x.status}:${x.message}`)).toEqual([
      "fail:Inline <script> in HTML",
      "fail:Loads https://cdn.example.com/x.js from another origin",
      "fail:Root-relative path /assets/app.css",
    ]);
  });

  it("allows the dev probe script and warns on a missing viewport", async () => {
    const f = await scan({ "index.html": `<html><head><script data-thumbcade-probe>1</script><script type="module" src="./assets/main.js"></script></head></html>` });
    expect(f.map((x) => x.message)).toEqual(["No viewport meta tag"]);
  });

  it("fails network calls to other origins and warns on eval and harmless remote strings", async () => {
    const f = await scan({
      "assets/main.js": 'fetch("https://api.tracker.io/collect");\nconst e = eval("1");\nconst doc = "see https://example.org/docs";\nconst ns = "http://www.w3.org/2000/svg";',
    });
    const all = f.map((x) => `${x.status}:${x.message}`);
    expect(all.some((m) => m.startsWith("fail:Network request to https://api.tracker.io/collect"))).toBe(true);
    expect(all).toContain("warn:Uses eval()");
    expect(all.some((m) => m.startsWith("warn:References 1 remote host: example.org"))).toBe(true);
    expect(all.join(" ")).not.toContain("w3.org");
  });

  it("fails WebRTC and obfuscated code, and warns when a game navigates its page", async () => {
    const names = Array.from({ length: 12 }, (_, i) => `_0x${(0x1a2b + i * 7).toString(16)}`);
    const obfuscated = `var ${names.map((n, i) => `${n}=${i}`).join(",")};function _0x4f2a(){return ${names.join("+")}}`;
    const f = await scan({
      "assets/main.js": 'const pc = new RTCPeerConnection({ iceServers: [] });\nwindow.location.href = "https://example.org/?d=" + score;',
      "assets/chunk.js": obfuscated,
    });
    expect(f.map((x) => `${x.status}:${x.file}:${x.message}`)).toEqual([
      "fail:assets/chunk.js:Looks obfuscated: 13 hex-named identifiers (_0x…)",
      "fail:assets/main.js:Uses WebRTC (RTCPeerConnection)",
      "warn:assets/main.js:Navigates the page (location = …)",
      "warn:assets/main.js:References 1 remote host: example.org",
    ]);
  });

  it("doesn't mistake minified engines or shader code for navigation or obfuscation", async () => {
    const f = await scan({
      "assets/main.js":
        'const s="#version 300 es\\nlayout(location = 0) out highp vec4 pc_fragColor;";function n(t){const location=t.gl.getAttribLocation(t.p,"a");t.location=location;return location}var e=[1,2,3].map(function(r){return r*2});console.log(location.href===""?e:s)',
    });
    expect(f).toEqual([]);
  });

  it("recognises packers, decoded-and-run code and hex-escaped strings", () => {
    expect(obfuscationSign("eval(function(p,a,c,k,e,d){return p}('x',1,1,'x'.split('|'),0,{}))")).toMatch(/packer/);
    expect(obfuscationSign('new Function(atob("YWxlcnQoMSk="))()')).toBe("code decoded from a string and run");
    expect(obfuscationSign(`var s="${"\\x61".repeat(600)}";`)).toMatch(/600 \\x escapes/);
    expect(obfuscationSign(`var s="${"\\x61".repeat(600)}";${"var a=1;".repeat(20000)}`)).toBeNull();
    expect(obfuscationSign("[]".repeat(300))).toMatch(/\[\]\(\)!\+/);
  });

  it("fails remote fonts in CSS", async () => {
    const f = await scan({ "assets/app.css": '@import url("https://fonts.example.com/css");' });
    expect(f[0]).toMatchObject({ status: "fail" });
  });
});

describe("helpers", () => {
  it("reads PNG and JPEG sizes", () => {
    expect(imageSize(fakePng(1024, 768))).toEqual({ width: 1024, height: 768, type: "png" });
    expect(imageSize(fakeJpeg(1080, 1920))).toEqual({ width: 1080, height: 1920, type: "jpeg" });
    expect(imageSize(Buffer.from("not an image"))).toBeNull();
  });

  it("follows static imports and ignores dynamic ones", async () => {
    const files = await readBundle(await bundle({ "assets/main.js": 'import { x } from "./chunk.js";\nconst later = () => import("./later.js");' }));
    expect(initialFiles("index.html", files).sort()).toEqual(["assets/chunk.js", "assets/main.js", "index.html"]);
  });
});
