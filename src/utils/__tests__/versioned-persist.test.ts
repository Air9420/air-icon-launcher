import { beforeEach, describe, expect, it } from "vitest";
import "../storage-migrations";
import { getVersionedStorageKey } from "../storage-migrate";
import { createVersionedPersist } from "../versioned-persist";

function createMemoryStorage(): Storage {
  const bucket = new Map<string, string>();
  return {
    get length() {
      return bucket.size;
    },
    clear() {
      bucket.clear();
    },
    getItem(key: string) {
      return bucket.has(key) ? bucket.get(key)! : null;
    },
    key(index: number) {
      return Array.from(bucket.keys())[index] ?? null;
    },
    removeItem(key: string) {
      bucket.delete(key);
    },
    setItem(key: string, value: string) {
      bucket.set(key, value);
    },
  };
}

describe("versioned-persist", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
  });

  it("compacts default file icons on launcher persist write", () => {
    const storage = createVersionedPersist("launcher", ["launcherItemsByCategoryId"]);

    storage.setItem(
      "launcher",
      JSON.stringify({
        launcherItemsByCategoryId: {
          "cat-1": [
            {
              id: "file-default",
              itemType: "file",
              path: "C:\\A.exe",
              iconBase64: "icon-a",
              originalIconBase64: "icon-a",
            },
            {
              id: "file-custom",
              itemType: "file",
              path: "C:\\B.exe",
              iconBase64: "custom-b",
              originalIconBase64: "origin-b",
            },
            {
              id: "url-item",
              itemType: "url",
              path: "",
              url: "https://example.com",
              iconBase64: "icon-url",
              originalIconBase64: "icon-url",
            },
          ],
        },
      })
    );

    const raw = localStorage.getItem(getVersionedStorageKey("launcher"));
    const parsed = JSON.parse(raw as string) as {
      data: { launcherItemsByCategoryId: Record<string, Array<Record<string, unknown>>> };
    };
    const items = parsed.data.launcherItemsByCategoryId["cat-1"];

    expect(items[0].iconBase64).toBeNull();
    expect(items[0].hasCustomIcon).toBeUndefined();
    expect("originalIconBase64" in items[0]).toBe(false);
    expect(items[1].iconBase64).toBe("custom-b");
    expect(items[1].hasCustomIcon).toBe(true);
    expect("originalIconBase64" in items[1]).toBe(false);
    expect(items[2].iconBase64).toBe("icon-url");
    expect(items[2].hasCustomIcon).toBeUndefined();
    expect("originalIconBase64" in items[2]).toBe(false);
  });

  it("compacts default file icons on launcher persist read", () => {
    localStorage.setItem(
      getVersionedStorageKey("launcher"),
      JSON.stringify({
        version: 4,
        data: {
          launcherItemsByCategoryId: {
            "cat-1": [
              {
                id: "file-default",
                itemType: "file",
                path: "C:\\A.exe",
                iconBase64: "icon-a",
                originalIconBase64: "icon-a",
              },
              {
                id: "file-custom",
                itemType: "file",
                path: "C:\\B.exe",
                iconBase64: "custom-b",
                originalIconBase64: "origin-b",
              },
            ],
          },
        },
      })
    );

    const storage = createVersionedPersist("launcher", ["launcherItemsByCategoryId"]);
    const raw = storage.getItem("launcher");
    const parsed = JSON.parse(raw as string) as {
      launcherItemsByCategoryId: Record<string, Array<Record<string, unknown>>>;
    };
    const items = parsed.launcherItemsByCategoryId["cat-1"];

    expect(items[0].iconBase64).toBeNull();
    expect(items[0].hasCustomIcon).toBeUndefined();
    expect("originalIconBase64" in items[0]).toBe(false);
    expect(items[1].iconBase64).toBe("custom-b");
    expect(items[1].hasCustomIcon).toBe(true);
    expect("originalIconBase64" in items[1]).toBe(false);
  });
});
