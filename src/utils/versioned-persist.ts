import { migrateData, createVersionedData, getVersionedStorageKey } from "./storage-migrate";

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
                    let data = migrated.data as Record<string, unknown>;
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
                    let data = migrated.data as Record<string, unknown>;
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
                const versioned = createVersionedData(state, storeName);
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
