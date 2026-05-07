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

describe("settings tabs nav spacing", () => {
  it("uses real scrollable edge spacers so both left and right tails can be revealed", () => {
    const style = getStyleBlock();
    const activeTailWidth = getPseudoWidth(
      style,
      "\\.tab\\.active::after,\\s*\\.tab\\.active::before"
    );
    const edgeSpacerWidth = getPseudoWidth(
      style,
      "\\.tabs::before,\\s*\\.tabs::after"
    );

    expect(edgeSpacerWidth).toBeGreaterThanOrEqual(activeTailWidth);
  });

  it("lets the edge spacers render the outer tails for the first and last active tabs", () => {
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
    expectRuleContains(
      style,
      "\\.tabs:has\\(\\.tab:first-child\\.active\\)::before",
      "background: radial-gradient"
    );
    expectRuleContains(
      style,
      "\\.tabs:has\\(\\.tab:last-child\\.active\\)::after",
      "background: radial-gradient"
    );
  });
});
