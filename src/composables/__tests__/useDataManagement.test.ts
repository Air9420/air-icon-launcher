import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("../../utils/invoke-wrapper", () => ({
  invoke: vi.fn(),
  invokeOrThrow: vi.fn(),
}));

import {
  buildLauncherExportData,
  mapImportedLauncherItems,
  validateImportedData,
} from "../useDataManagement";

describe("useDataManagement helpers", () => {
  it("round-trips launch dependencies and launch delay fields", () => {
    const launcherData = buildLauncherExportData(
      [
        { id: "chat", name: "聊天", customIconBase64: null },
        { id: "infra", name: "网络", customIconBase64: null },
      ],
      {
        chat: [
          {
            id: "telegram",
            name: "Telegram",
            path: "C:\\Telegram.exe",
            url: undefined,
            itemType: "file",
            isDirectory: false,
            iconBase64: null,
            originalIconBase64: null,
            isFavorite: false,
            lastUsedAt: undefined,
            launchDependencies: [
              {
                categoryId: "infra",
                itemId: "vpn",
                delayAfterSeconds: 5,
              },
            ],
            launchDelaySeconds: 2,
          },
        ],
        infra: [
          {
            id: "vpn",
            name: "VPN",
            path: "C:\\VPN.exe",
            url: undefined,
            itemType: "file",
            isDirectory: false,
            iconBase64: null,
            originalIconBase64: null,
            isFavorite: false,
            lastUsedAt: undefined,
            launchDependencies: [],
            launchDelaySeconds: 0,
          },
        ],
      },
      ["telegram"],
      [
        {
          categoryId: "chat",
          itemId: "telegram",
          usedAt: 123,
          usageCount: 1,
        },
      ]
    );

    const itemsMap = mapImportedLauncherItems(launcherData.categories);
    const telegram = itemsMap.chat[0];

    expect(telegram.launchDependencies).toEqual([
      {
        categoryId: "infra",
        itemId: "vpn",
        delayAfterSeconds: 5,
      },
    ]);
    expect(telegram.launchDelaySeconds).toBe(2);
  });

  it("accepts a resolved launcher snapshot with valid favorite and recent references", () => {
    const validation = validateImportedData({
      launcher_data: {
        categories: [
          {
            id: "cat-1",
            name: "工具",
            items: [
              {
                id: "item-1",
                name: "PowerToys",
                is_directory: false,
                item_type: "file",
                path: "C:\\PowerToys.exe",
              },
            ],
          },
        ],
        favorite_item_ids: ["item-1"],
        recent_used_items: [
          {
            category_id: "cat-1",
            item_id: "item-1",
            used_at: 123,
            usage_count: 2,
          },
        ],
      },
    });

    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it("rejects favorite references that do not exist in the resolved launcher snapshot", () => {
    const validation = validateImportedData({
      launcher_data: {
        categories: [
          {
            id: "cat-1",
            name: "工具",
            items: [],
          },
        ],
        favorite_item_ids: ["missing-item"],
      },
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain(
      "launcher_data.pinned/favorite_item_ids[0] 引用不存在: missing-item"
    );
  });
});
