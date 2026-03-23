export type VersionedData<T> = {
    version: number;
    data: T;
};

export type MigrationFn<T> = (oldData: unknown) => T;

export interface StoreSchema {
    [storeName: string]: {
        currentVersion: number;
        migrations: {
            [version: number]: MigrationFn<unknown>;
        };
    };
}

const registeredStores: Map<string, {
    currentVersion: number;
    migrations: Map<number, MigrationFn<unknown>>;
}> = new Map();

export function registerStoreVersion(
    storeName: string,
    currentVersion: number,
    migrations: { fromVersion: number; migrate: MigrationFn<unknown> }[]
): void {
    const migrationMap = new Map<number, MigrationFn<unknown>>();
    for (const m of migrations) {
        migrationMap.set(m.fromVersion, m.migrate);
    }
    registeredStores.set(storeName, {
        currentVersion,
        migrations: migrationMap,
    });
}

export function getRegisteredStores(): Map<string, {
    currentVersion: number;
    migrations: Map<number, MigrationFn<unknown>>;
}> {
    return registeredStores;
}

export function migrateData<T>(
    storeName: string,
    storedData: unknown
): VersionedData<T> {
    const registered = registeredStores.get(storeName);

    if (!registered) {
        return {
            version: 0,
            data: storedData as T,
        };
    }

    if (storedData && typeof storedData === 'object' && 'version' in storedData && 'data' in storedData) {
        const versioned = storedData as VersionedData<T>;
        if (versioned.version === registered.currentVersion) {
            return versioned;
        }

        let currentData: unknown = versioned.data;
        for (
            let v = versioned.version;
            v < registered.currentVersion;
            v++
        ) {
            const migration = registered.migrations.get(v);
            if (migration) {
                currentData = migration(currentData);
            }
        }

        return {
            version: registered.currentVersion,
            data: currentData as T,
        };
    }

    let currentData: unknown = storedData;
    if (storedData !== null && storedData !== undefined) {
        for (
            let v = 0;
            v < registered.currentVersion;
            v++
        ) {
            const migration = registered.migrations.get(v);
            if (migration) {
                currentData = migration(currentData);
            }
        }
    }

    return {
        version: registered.currentVersion,
        data: currentData as T,
    };
}

export function createVersionedData<T>(data: T, storeName: string): VersionedData<T> {
    const registered = registeredStores.get(storeName);
    return {
        version: registered?.currentVersion ?? 1,
        data,
    };
}

export function getVersionedStorageKey(storeName: string): string {
    return `__versioned_${storeName}__`;
}
