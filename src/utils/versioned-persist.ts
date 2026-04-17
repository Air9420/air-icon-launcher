import { migrateData, createVersionedData, getVersionedStorageKey } from "./storage-migrate";

type PersistData = Record<string, unknown>;
type PersistTransform = {
    onRead?: (data: PersistData) => PersistData;
    onWrite?: (data: PersistData) => PersistData;
};

function normalizeBase64Value(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function compactLauncherPersistData(data: PersistData): PersistData {
    if (!data || typeof data !== "object") {
        return data;
    }
    const launcherItemsByCategoryId = data.launcherItemsByCategoryId as Record<string, unknown> | undefined;
    if (!launcherItemsByCategoryId || typeof launcherItemsByCategoryId !== "object") {
        return data;
    }

    let hasAnyCategoryChanged = false;
    const nextLauncherItemsByCategoryId: Record<string, unknown> = {};

    for (const [categoryId, rawItems] of Object.entries(launcherItemsByCategoryId)) {
        if (!Array.isArray(rawItems)) {
            nextLauncherItemsByCategoryId[categoryId] = rawItems;
            continue;
        }

        let hasCategoryChanged = false;
        const nextItems = rawItems.map((rawItem) => {
            if (!rawItem || typeof rawItem !== "object") return rawItem;

            const item = rawItem as Record<string, unknown>;
            const itemType = item.itemType === "url" ? "url" : "file";
            if (itemType !== "file") return rawItem;

            const path = typeof item.path === "string" ? item.path.trim() : "";
            if (!path) return rawItem;

            const icon = normalizeBase64Value(item.iconBase64);
            const originalIcon = normalizeBase64Value(item.originalIconBase64);
            const hasCustomIcon = icon !== originalIcon;

            if (hasCustomIcon || !icon) {
                return rawItem;
            }

            hasCategoryChanged = true;
            return {
                ...item,
                iconBase64: null,
                originalIconBase64: null,
            };
        });

        if (hasCategoryChanged) {
            hasAnyCategoryChanged = true;
        }
        nextLauncherItemsByCategoryId[categoryId] = nextItems;
    }

    if (!hasAnyCategoryChanged) {
        return data;
    }

    return {
        ...data,
        launcherItemsByCategoryId: nextLauncherItemsByCategoryId,
    };
}

const persistTransforms: Record<string, PersistTransform> = {
    launcher: {
        onRead: compactLauncherPersistData,
        onWrite: compactLauncherPersistData,
    },
};

function applyPersistReadTransform(storeName: string, data: PersistData): PersistData {
    const transform = persistTransforms[storeName];
    return transform?.onRead ? transform.onRead(data) : data;
}

function applyPersistWriteTransform(storeName: string, data: PersistData): PersistData {
    const transform = persistTransforms[storeName];
    return transform?.onWrite ? transform.onWrite(data) : data;
}

export function createVersionedPersist(storeName: string, pick?: string[], exclude?: string[]) {
    const versionedKey = getVersionedStorageKey(storeName);
    const effectivePick = pick;
    const effectiveExclude = exclude;

    const storageAdapter = {
        getItem(key: string): string | null {
            if (key !== storeName) {
                return localStorage.getItem(key);
            }

            const versionedRaw = localStorage.getItem(versionedKey);
            if (versionedRaw) {
                try {
                    const versioned = JSON.parse(versionedRaw);
                    const migrated = migrateData(storeName, versioned);
                    let data = migrated.data as PersistData;
                    data = applyPersistReadTransform(storeName, data);
                    if (effectivePick) {
                        data = Object.fromEntries(
                            Object.entries(data).filter(([k]) => effectivePick.includes(k))
                        );
                    }
                    if (effectiveExclude) {
                        data = Object.fromEntries(
                            Object.entries(data).filter(([k]) => !effectiveExclude.includes(k))
                        );
                    }
                    return JSON.stringify(data);
                } catch (e) {
                    console.error(`[Storage] Failed to read versioned data for ${storeName}:`, e);
                }
            }

            const legacyRaw = localStorage.getItem(key);
            if (legacyRaw) {
                try {
                    const legacy = JSON.parse(legacyRaw);
                    const migrated = migrateData(storeName, legacy);
                    localStorage.setItem(versionedKey, JSON.stringify(migrated));
                    try {
                        localStorage.removeItem(key);
                    } catch {}
                    let data = migrated.data as PersistData;
                    data = applyPersistReadTransform(storeName, data);
                    if (effectivePick) {
                        data = Object.fromEntries(
                            Object.entries(data).filter(([k]) => effectivePick.includes(k))
                        );
                    }
                    return JSON.stringify(data);
                } catch (e) {
                    console.error(`[Storage] Failed to migrate legacy data for ${storeName}:`, e);
                }
            }
            return null;
        },
        setItem(key: string, value: string): void {
            if (key !== storeName) {
                localStorage.setItem(key, value);
                return;
            }

            try {
                const state = JSON.parse(value);
                const transformedState = applyPersistWriteTransform(storeName, state);
                const versioned = createVersionedData(transformedState, storeName);
                localStorage.setItem(versionedKey, JSON.stringify(versioned));
            } catch (e) {
                console.error(`[Storage] Failed to save versioned data for ${storeName}:`, e);
            }
        },
        removeItem(key: string): void {
            localStorage.removeItem(versionedKey);
            localStorage.removeItem(key);
        },
    };

    return storageAdapter;
}

export function createVersionedPersistConfig(storeName: string, pick?: string[], exclude?: string[]) {
    return {
        storage: createVersionedPersist(storeName, pick, exclude),
        pick: pick,
        exclude: exclude,
    };
}
