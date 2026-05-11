import { describe, expect, it } from "vitest";
import { ensureUrlProtocol } from "../launcher-service";

describe("ensureUrlProtocol", () => {
  it("keeps http and https URLs unchanged", () => {
    expect(ensureUrlProtocol("https://example.com")).toBe("https://example.com");
    expect(ensureUrlProtocol("http://example.com")).toBe("http://example.com");
  });

  it("keeps non-http launch schemes unchanged", () => {
    expect(ensureUrlProtocol("steam://rungameid/937310")).toBe("steam://rungameid/937310");
    expect(ensureUrlProtocol("shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App")).toBe(
      "shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App",
    );
  });

  it("keeps adding https to plain domains", () => {
    expect(ensureUrlProtocol("example.com")).toBe("https://example.com");
  });
});
