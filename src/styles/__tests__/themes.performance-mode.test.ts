import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const themesSource = readFileSync(new URL("../themes.scss", import.meta.url), "utf8");

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getBlocks(selector: string): string[] {
  const pattern = new RegExp(
    `${escapeForRegex(selector)}\\s*\\{([\\s\\S]*?)\\n\\}`,
    "g"
  );
  return [...themesSource.matchAll(pattern)].map((match) => match[1]);
}

function getDeclarationAlpha(block: string, variableName: string): number {
  const match = block.match(
    new RegExp(
      `${escapeForRegex(variableName)}:\\s*rgba\\([^;]*,\\s*([0-9.]+)\\s*\\);`
    )
  );
  expect(match, `Missing rgba declaration for ${variableName}`).toBeTruthy();
  return Number(match?.[1] ?? Number.NaN);
}

type SurfaceExpectations = {
  bg: [number, number];
  card: [number, number];
  menu: [number, number];
  border: [number, number];
  borderStrong: [number, number];
};

function expectRange(value: number, [min, max]: [number, number], label: string): void {
  expect(value, `${label} should be >= ${min}`).toBeGreaterThanOrEqual(min);
  expect(value, `${label} should be <= ${max}`).toBeLessThanOrEqual(max);
}

function expectTranslucentSurfaceBlock(
  selector: string,
  expectations: SurfaceExpectations
): void {
  const blocks = getBlocks(selector);
  expect(blocks.length, `Missing theme block for ${selector}`).toBeGreaterThan(0);

  for (const block of blocks) {
    expectRange(
      getDeclarationAlpha(block, "--bg-color"),
      expectations.bg,
      `${selector} --bg-color`
    );
    expectRange(
      getDeclarationAlpha(block, "--card-bg"),
      expectations.card,
      `${selector} --card-bg`
    );
    expectRange(
      getDeclarationAlpha(block, "--menu-bg"),
      expectations.menu,
      `${selector} --menu-bg`
    );
    expectRange(
      getDeclarationAlpha(block, "--border-color"),
      expectations.border,
      `${selector} --border-color`
    );
    expectRange(
      getDeclarationAlpha(block, "--border-color-strong"),
      expectations.borderStrong,
      `${selector} --border-color-strong`
    );
  }
}

describe("performance mode theme tokens", () => {
  it("keeps blur disabled without collapsing surfaces into opaque panels", () => {
    expect(themesSource).toMatch(
      /\[data-effects-disabled="true"\]\s*\{\s*--backdrop-blur:\s*none;/
    );

    expectTranslucentSurfaceBlock(
      '[data-effects-disabled="true"][data-theme="light"]',
      {
        bg: [0.4, 0.65],
        card: [0.88, 0.95],
        menu: [0.94, 0.97],
        border: [0.1, 0.18],
        borderStrong: [0.16, 0.26],
      }
    );
    expectTranslucentSurfaceBlock(
      '[data-effects-disabled="true"][data-theme="dark"]',
      {
        bg: [0.4, 0.65],
        card: [0.88, 0.95],
        menu: [0.94, 0.97],
        border: [0.14, 0.22],
        borderStrong: [0.2, 0.28],
      }
    );
    expectTranslucentSurfaceBlock(
      '[data-effects-disabled="true"][data-theme="transparent"]',
      {
        bg: [0.28, 0.42],
        card: [0.7, 0.82],
        menu: [0.9, 0.95],
        border: [0.16, 0.24],
        borderStrong: [0.22, 0.3],
      }
    );
    expectTranslucentSurfaceBlock(
      '[data-effects-disabled="true"][data-theme="system"]',
      {
        bg: [0.4, 0.65],
        card: [0.88, 0.95],
        menu: [0.94, 0.97],
        border: [0.1, 0.22],
        borderStrong: [0.16, 0.28],
      }
    );
  });
});
