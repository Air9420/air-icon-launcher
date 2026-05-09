import { invoke } from "@tauri-apps/api/core";
import { itemEventBus } from "../events/itemEvents";
import { useItemsStore } from "../stores/itemsStore";

const iconCache = new Map<string, string>();
const originalIconCache = new Map<string, string>();

export function cacheIcon(path: string, base64: string): void {
    iconCache.set(path, base64);
}

export function getCachedIcon(path: string): string | null {
    return iconCache.get(path) ?? null;
}

export function cacheOriginalIcon(path: string, base64: string): void {
    originalIconCache.set(path, base64);
}

export function getOriginalIcon(path: string): string | null {
    return originalIconCache.get(path) ?? null;
}

export function removeIconsForPaths(paths: string[]): void {
    for (const path of paths) {
        iconCache.delete(path);
        originalIconCache.delete(path);
    }
}

export async function extractIcons(paths: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();

    try {
        const response = await invoke<Array<string | null>>("extract_icons_from_paths", {
            paths,
            maxEdge: 128,
        });
        for (let i = 0; i < paths.length; i++) {
            const icon = response[i];
            if (icon) {
                result.set(paths[i], icon);
                cacheIcon(paths[i], icon);
            }
        }
    } catch (e) {
        console.error("Failed to extract icons:", e);
    }

    return result;
}

export async function fetchFavicon(url: string): Promise<string | null> {
    try {
        const result = await invoke<{ ok: boolean; value?: string }>("fetch_favicon_from_url", { url });
        if (result.ok && result.value) {
            return result.value;
        }
    } catch (e) {
        console.warn("Failed to fetch favicon:", e);
    }
    return null;
}

export function initIconCache() {
    const itemsStore = useItemsStore();

    itemEventBus.on('item:created', (e) => {
        if (e.item.iconBase64 && e.item.itemType === 'file') {
            cacheOriginalIcon(e.item.path, e.item.iconBase64);
        }
    });

    itemEventBus.on('item:iconUpdated', (e) => {
        if (e.iconBase64) {
            const item = itemsStore.getLauncherItemById(e.categoryId, e.itemId);
            if (item && item.itemType === 'file') {
                cacheOriginalIcon(item.path, e.iconBase64);
            }
        }
    });

    for (const items of Object.values(itemsStore.launcherItemsByCategoryId)) {
        for (const item of items) {
            if (item.iconBase64 && item.itemType === 'file') {
                cacheOriginalIcon(item.path, item.iconBase64);
            }
        }
    }
}
