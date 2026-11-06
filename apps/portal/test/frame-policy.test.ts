import { describe, expect, it } from "vitest";
import { portalCsp } from "../src/lib/frame-policy";

describe("portalCsp", () => {
  it("only lets pages frame the games origin", () => {
    expect(portalCsp("http://127.0.0.1:5555")).toBe("frame-src http://127.0.0.1:5555");
    expect(portalCsp("http://localhost:5555/")).toBe("frame-src http://localhost:5555");
    expect(portalCsp("subdomain:thumbcade.gg")).toBe("frame-src https://*.thumbcade.gg");
  });
});
