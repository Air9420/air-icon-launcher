import { describe, expect, it, vi } from "vitest";
import {
  executeLauncherItemWithDependencies,
  LauncherExecutionError,
  type ExecutableLauncherItem,
  type LauncherItemRef,
} from "../launcher-executor";

function createRef(categoryId: string, itemId: string): LauncherItemRef {
  return { categoryId, itemId };
}

function createItem(
  id: string,
  name: string,
  overrides: Partial<ExecutableLauncherItem> = {}
): ExecutableLauncherItem {
  return {
    id,
    name,
    path: `C:\\${name}.exe`,
    itemType: "file",
    url: undefined,
    launchDependencies: [],
    launchDelaySeconds: 0,
    ...overrides,
  };
}

describe("launcher-executor", () => {
  it("launches dependencies in order and applies dependency + primary delays", async () => {
    const items = new Map<string, ExecutableLauncherItem>([
      [
        "net:vpn",
        createItem("vpn", "VPN", {
          launchDelaySeconds: 99,
        }),
      ],
      [
        "chat:telegram",
        createItem("telegram", "Telegram", {
          launchDependencies: [
            { categoryId: "net", itemId: "vpn", delayAfterSeconds: 5 },
          ],
          launchDelaySeconds: 2,
        }),
      ],
    ]);

    const launched: string[] = [];
    const waits: number[] = [];

    const result = await executeLauncherItemWithDependencies({
      target: createRef("chat", "telegram"),
      getItem: (categoryId, itemId) => items.get(`${categoryId}:${itemId}`) ?? null,
      launchItem: async (item) => {
        launched.push(item.name);
      },
      wait: async (ms) => {
        waits.push(ms);
      },
    });

    expect(launched).toEqual(["VPN", "Telegram"]);
    expect(waits).toEqual([5000, 2000]);
    expect(result.launchedRefs).toEqual([
      createRef("net", "vpn"),
      createRef("chat", "telegram"),
    ]);
  });

  it("deduplicates repeated dependencies across the same chain", async () => {
    const items = new Map<string, ExecutableLauncherItem>([
      [
        "infra:vpn",
        createItem("vpn", "VPN"),
      ],
      [
        "infra:proxy",
        createItem("proxy", "Proxy", {
          launchDependencies: [
            { categoryId: "infra", itemId: "vpn", delayAfterSeconds: 3 },
          ],
        }),
      ],
      [
        "chat:telegram",
        createItem("telegram", "Telegram", {
          launchDependencies: [
            { categoryId: "infra", itemId: "vpn", delayAfterSeconds: 5 },
            { categoryId: "infra", itemId: "proxy", delayAfterSeconds: 1 },
          ],
        }),
      ],
    ]);

    const launched: string[] = [];
    const waits: number[] = [];

    await executeLauncherItemWithDependencies({
      target: createRef("chat", "telegram"),
      getItem: (categoryId, itemId) => items.get(`${categoryId}:${itemId}`) ?? null,
      launchItem: async (item) => {
        launched.push(item.name);
      },
      wait: async (ms) => {
        waits.push(ms);
      },
    });

    expect(launched).toEqual(["VPN", "Proxy", "Telegram"]);
    expect(waits).toEqual([5000, 1000]);
  });

  it("throws on circular dependencies", async () => {
    const items = new Map<string, ExecutableLauncherItem>([
      [
        "chat:telegram",
        createItem("telegram", "Telegram", {
          launchDependencies: [
            { categoryId: "infra", itemId: "vpn", delayAfterSeconds: 0 },
          ],
        }),
      ],
      [
        "infra:vpn",
        createItem("vpn", "VPN", {
          launchDependencies: [
            { categoryId: "chat", itemId: "telegram", delayAfterSeconds: 0 },
          ],
        }),
      ],
    ]);

    await expect(
      executeLauncherItemWithDependencies({
        target: createRef("chat", "telegram"),
        getItem: (categoryId, itemId) => items.get(`${categoryId}:${itemId}`) ?? null,
        launchItem: vi.fn(),
      })
    ).rejects.toMatchObject<Partial<LauncherExecutionError>>({
      code: "CIRCULAR_DEPENDENCY",
    });
  });

  it("throws when a dependency is missing", async () => {
    const items = new Map<string, ExecutableLauncherItem>([
      [
        "chat:telegram",
        createItem("telegram", "Telegram", {
          launchDependencies: [
            { categoryId: "infra", itemId: "vpn", delayAfterSeconds: 0 },
          ],
        }),
      ],
    ]);

    await expect(
      executeLauncherItemWithDependencies({
        target: createRef("chat", "telegram"),
        getItem: (categoryId, itemId) => items.get(`${categoryId}:${itemId}`) ?? null,
        launchItem: vi.fn(),
      })
    ).rejects.toMatchObject<Partial<LauncherExecutionError>>({
      code: "MISSING_ITEM",
    });
  });

  it("stops execution when a dependency launch fails", async () => {
    const items = new Map<string, ExecutableLauncherItem>([
      [
        "infra:vpn",
        createItem("vpn", "VPN"),
      ],
      [
        "chat:telegram",
        createItem("telegram", "Telegram", {
          launchDependencies: [
            { categoryId: "infra", itemId: "vpn", delayAfterSeconds: 0 },
          ],
        }),
      ],
    ]);

    const launched: string[] = [];

    await expect(
      executeLauncherItemWithDependencies({
        target: createRef("chat", "telegram"),
        getItem: (categoryId, itemId) => items.get(`${categoryId}:${itemId}`) ?? null,
        launchItem: async (item) => {
          launched.push(item.name);
          if (item.id === "vpn") {
            throw new Error("boom");
          }
        },
      })
    ).rejects.toMatchObject<Partial<LauncherExecutionError>>({
      code: "LAUNCH_FAILED",
    });

    expect(launched).toEqual(["VPN"]);
  });
});
