import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../index.vue", import.meta.url), "utf8");
const styleBlockMatch = source.match(/<style scoped>([\s\S]*?)<\/style>/);

function getStyleBlock(): string {
  expect(styleBlockMatch, "Missing scoped style block in settings/index.vue").toBeTruthy();
  return styleBlockMatch?.[1] ?? "";
}

function getPseudoWidth(style: string, selector: string): number {
  const regex = new RegExp(
    `${selector}\\s*\\{[\\s\\S]*?width:\\s*([0-9.]+)px;[\\s\\S]*?\\}`,
    "m"
  );
  const match = style.match(regex);
  expect(match, `Missing width on ${selector}`).toBeTruthy();
  return Number(match?.[1] ?? Number.NaN);
}

function expectRuleContains(style: string, selector: string, declaration: string): void {
  const regex = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\}`, "m");
  const match = style.match(regex);
  expect(match, `Missing rule for ${selector}`).toBeTruthy();
  expect(match?.[1] ?? "").toContain(declaration);
}

/**
 * Current tabs nav strategy (settings/index.vue):
 * - `.tabs::before/after` are small flex edge spacers (scroll tail padding).
 * - Active tab corner tails are 16px radial gradients on `.tab.active::before/after`.
 * - First/last active tabs disable their OUTER tail (`content: none`) so the
 *   decoration does not paint outside the scroll viewport.
 * - There is no `:has()` gradient fallback on the edge spacers.
 */
describe("settings tabs nav spacing", () => {
  it("keeps scrollable edge spacers on the tabs strip", () => {
    const style = getStyleBlock();
    const edgeSpacerWidth = getPseudoWidth(style, "\\.tabs::before,\\s*\\.tabs::after");
    const activeTailWidth = getPseudoWidth(
      style,
      "\\.tab\\.active::after,\\s*\\.tab\\.active::before"
    );

    // Edge spacers reserve scroll padding; they are intentionally smaller than
    // the 16px active-tail decorations.
    expect(edgeSpacerWidth).toBeGreaterThan(0);
    expect(activeTailWidth).toBeGreaterThan(edgeSpacerWidth);
  });

  it("disables outer tails on first/last active tabs so decorations stay in-view", () => {
    const style = getStyleBlock();

    expectRuleContains(
      style,
      "\\.tab:first-child\\.active::before",
      "content: none"
    );
    expectRuleContains(
      style,
      "\\.tab:last-child\\.active::after",
      "content: none"
    );
  });

  it("draws active-tail radial gradients on the tab pseudo-elements", () => {
    const style = getStyleBlock();

    // Standalone rules (not the combined base block) carry the gradients.
    expect(style).toMatch(
      /\.tab\.active::before\s*\{[^}]*background:\s*radial-gradient/
    );
    expect(style).toMatch(
      /\.tab\.active::after\s*\{[^}]*background:\s*radial-gradient/
    );
  });
});
