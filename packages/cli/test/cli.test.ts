import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readBundle } from "../src/checks/index.ts";
import { main } from "../src/cli.ts";
import { clearToken, endpoints, isCreatorToken, loadToken, profileKey, saveToken } from "../src/config.ts";
import { deviceDeepLink } from "../src/devserver.ts";
import { zipBundle } from "../src/zip.ts";
import { bundle } from "./fixtures.ts";

const TOKEN = `tc_${"ab".repeat(24)}`;

describe("credentials", () => {
  afterEach(() => {
    delete process.env.THUMBCADE_CONFIG_DIR;
    delete process.env.THUMBCADE_TOKEN;
    delete process.env.THUMBCADE_FUNCTIONS_URL;
  });

  it("stores tokens per backend in a 0600 file when the keychain is off", async () => {
    process.env.THUMBCADE_CONFIG_DIR = await mkdtemp(join(tmpdir(), "tc-cfg-"));
    process.env.THUMBCADE_NO_KEYCHAIN = "1";
    expect(await loadToken()).toBeNull();
    expect(await saveToken(TOKEN, "ines")).toBe("file");
    expect(await loadToken()).toMatchObject({ token: TOKEN, handle: "ines" });
    process.env.THUMBCADE_FUNCTIONS_URL = "https://abc.supabase.co/functions/v1";
    expect(profileKey()).toBe("abc.supabase.co");
    expect(await loadToken()).toBeNull(); // a different backend has its own login
    delete process.env.THUMBCADE_FUNCTIONS_URL;
    expect(await clearToken()).toBe(true);
    expect(await loadToken()).toBeNull();
  });

  it("THUMBCADE_TOKEN wins (CI)", async () => {
    process.env.THUMBCADE_CONFIG_DIR = await mkdtemp(join(tmpdir(), "tc-cfg-"));
    process.env.THUMBCADE_TOKEN = TOKEN;
    expect(await loadToken()).toMatchObject({ token: TOKEN, source: "THUMBCADE_TOKEN" });
  });

  it("recognizes creator tokens and defaults to the local stack", () => {
    expect(isCreatorToken(TOKEN)).toBe(true);
    expect(isCreatorToken("tc_short")).toBe(false);
    expect(isCreatorToken("eyJhbGciOi.jwt")).toBe(false);
    expect(endpoints()).toEqual({ portalUrl: "http://localhost:3000", functionsUrl: "http://127.0.0.1:54321/functions/v1" });
  });
});

describe("zip + device link", () => {
  it("zips a bundle with thumbcade.json at the root", async () => {
    const files = await readBundle(await bundle());
    const unzipped = unzipSync(zipBundle(files));
    expect(Object.keys(unzipped).sort()).toEqual(files.map((f) => f.path).sort());
    expect(JSON.parse(strFromU8(unzipped["thumbcade.json"]!)).id).toBe("fixture-game");
  });

  it("builds the deep link the app's developer menu opens", () => {
    expect(deviceDeepLink("http://192.168.1.20:5173/__game/index.html")).toBe("thumbcade://dev?url=http%3A%2F%2F192.168.1.20%3A5173%2F__game%2Findex.html");
  });
});

describe("main", () => {
  it("prints help and rejects unknown commands", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await main(["--help"])).toBe(0);
    expect(await main(["teleport"])).toBe(2);
    expect(await main(["--version"])).toBe(0);
    log.mockRestore();
    err.mockRestore();
  });

  it("explains what to do outside a game project", async () => {
    const cwd = process.cwd();
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.chdir(await mkdtemp(join(tmpdir(), "tc-empty-")));
    try {
      expect(await main(["validate"])).toBe(1);
      expect(err.mock.calls.flat().join(" ")).toContain("No thumbcade.json");
    } finally {
      process.chdir(cwd);
      err.mockRestore();
      log.mockRestore();
    }
  });
});
