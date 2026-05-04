import { describe, it, expect } from "vitest";
import { isNoiseName, normalizePathKey } from "../scan-fallback";

describe("scan fallback utils", () => {
  it("normalizes path keys case-insensitively", () => {
    expect(normalizePathKey("C:\\Apps\\WeChat.EXE")).toBe("c:/apps/wechat.exe");
  });

  it("normalizes lnk suffix for dedupe", () => {
    expect(normalizePathKey("C:\\Apps\\WeChat.lnk")).toBe("c:/apps/wechat");
  });

  it("detects noise names", () => {
    expect(isNoiseName("Uninstall Helper")).toBe(true);
    expect(isNoiseName("WeChat")).toBe(false);
  });
});
