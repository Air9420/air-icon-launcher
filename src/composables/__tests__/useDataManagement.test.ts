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
            hasCustomIcon: false,
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
            hasCustomIcon: false,
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

  it("allows stale pinned and recent references because soft metadata is filtered on apply", () => {
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
        favorite_item_ids: ["missing-item"],
        recent_used_items: [
          {
            category_id: "cat-1",
            item_id: "missing-item",
            used_at: 123,
            usage_count: 1,
          },
        ],
      },
    });

    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it("filters stale pinned and recent references during export", () => {
    const launcherData = buildLauncherExportData(
      [{ id: "cat-1", name: "工具", customIconBase64: null }],
      {
        "cat-1": [
          {
            id: "item-1",
            name: "PowerToys",
            path: "C:\\PowerToys.exe",
            url: undefined,
            itemType: "file",
            isDirectory: false,
            iconBase64: null,
            hasCustomIcon: false,
            isFavorite: false,
            lastUsedAt: undefined,
            launchDependencies: [],
            launchDelaySeconds: 0,
          },
        ],
      },
      ["item-1", "missing-item"],
      [
        {
          categoryId: "cat-1",
          itemId: "item-1",
          usedAt: 123,
          usageCount: 2,
        },
        {
          categoryId: "cat-1",
          itemId: "missing-item",
          usedAt: 456,
          usageCount: 1,
        },
      ]
    );

    expect(launcherData.favorite_item_ids).toEqual(["item-1"]);
    expect(launcherData.recent_used_items).toEqual([
      {
        category_id: "cat-1",
        item_id: "item-1",
        used_at: 123,
        usage_count: 2,
      },
    ]);
  });

  it("exports custom icon state without original_icon_base64", () => {
    const launcherData = buildLauncherExportData(
      [{ id: "cat-1", name: "工具", customIconBase64: null }],
      {
        "cat-1": [
          {
            id: "item-file-default",
            name: "PowerToys",
            path: "C:\\PowerToys.exe",
            url: undefined,
            itemType: "file",
            isDirectory: false,
            iconBase64: "default-icon",
            hasCustomIcon: false,
            isFavorite: false,
            lastUsedAt: undefined,
            launchDependencies: [],
            launchDelaySeconds: 0,
          },
          {
            id: "item-file-custom",
            name: "Custom",
            path: "C:\\Custom.exe",
            url: undefined,
            itemType: "file",
            isDirectory: false,
            iconBase64: "custom-icon",
            hasCustomIcon: true,
            isFavorite: false,
            lastUsedAt: undefined,
            launchDependencies: [],
            launchDelaySeconds: 0,
          },
        ],
      },
      [],
      []
    );

    expect(launcherData.categories[0].items).toEqual([
      expect.objectContaining({
        id: "item-file-default",
        icon_base64: null,
      }),
      expect.objectContaining({
        id: "item-file-custom",
        icon_base64: "custom-icon",
        has_custom_icon: true,
      }),
    ]);
    expect("original_icon_base64" in launcherData.categories[0].items[0]).toBe(false);
    expect("original_icon_base64" in launcherData.categories[0].items[1]).toBe(false);
  });

  it("maps legacy original_icon_base64 to hasCustomIcon during import", () => {
    const itemsMap = mapImportedLauncherItems([
      {
        id: "cat-1",
        name: "工具",
        items: [
          {
            id: "item-1",
            name: "Custom",
            path: "C:\\Custom.exe",
            item_type: "file",
            is_directory: false,
            icon_base64: "custom-icon",
            original_icon_base64: "default-icon",
          },
          {
            id: "item-2",
            name: "Default",
            path: "C:\\Default.exe",
            item_type: "file",
            is_directory: false,
            icon_base64: "default-icon",
            original_icon_base64: "default-icon",
          },
        ],
      },
    ]);

    expect(itemsMap["cat-1"][0].hasCustomIcon).toBe(true);
    expect(itemsMap["cat-1"][1].hasCustomIcon).toBe(false);
  });
});
