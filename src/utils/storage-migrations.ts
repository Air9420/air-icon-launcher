import { registerStoreVersion } from "./storage-migrate";

registerStoreVersion("launcher", 4, [
    {
        fromVersion: 1,
        migrate: (v1Data: unknown) => migrateLauncherV1ToV2(v1Data),
    },
    {
        fromVersion: 2,
        migrate: (v2Data: unknown) => migrateLauncherV2ToV3(v2Data),
    },
    {
        fromVersion: 3,
        migrate: (v3Data: unknown) => migrateLauncherV3ToV4(v3Data),
    },
]);

function migrateLauncherV1ToV2(v1Data: unknown): unknown {
    const data = v1Data as Record<string, unknown>;
    return {
        ...data,
        _migratedToV2: true,
        _migratedAt: Date.now(),
    };
}

function migrateLauncherV2ToV3(v2Data: unknown): unknown {
    const data = v2Data as Record<string, unknown>;
    const launcherItemsByCategoryId = data.launcherItemsByCategoryId as Record<string, Array<Record<string, unknown>>>;

    if (launcherItemsByCategoryId) {
        for (const categoryId of Object.keys(launcherItemsByCategoryId)) {
            const items = launcherItemsByCategoryId[categoryId];
            if (Array.isArray(items)) {
                for (const item of items) {
                    if (item.itemType === undefined) {
                        item.itemType = 'file';
                    }
                    const path = item.path as string;
                    if (path && (path.startsWith('http://') || path.startsWith('https://'))) {
                        item.url = path;
                        item.path = '';
                        item.itemType = 'url';
                    }
                }
            }
        }
    }

    return {
        ...data,
        _migratedToV3: true,
        _migratedAt: Date.now(),
    };
}

function migrateLauncherV3ToV4(v3Data: unknown): unknown {
    const data = v3Data as Record<string, unknown>;
    const launcherItemsByCategoryId = data.launcherItemsByCategoryId as Record<string, Array<Record<string, unknown>>>;

    if (launcherItemsByCategoryId) {
        for (const categoryId of Object.keys(launcherItemsByCategoryId)) {
            const items = launcherItemsByCategoryId[categoryId];
            if (!Array.isArray(items)) continue;

            for (const item of items) {
                if (!Array.isArray(item.launchDependencies)) {
                    item.launchDependencies = [];
                }
                if (typeof item.launchDelaySeconds !== "number") {
                    item.launchDelaySeconds = 0;
                }
            }
        }
    }

    return {
        ...data,
        _migratedToV4: true,
        _migratedAt: Date.now(),
    };
}
registerStoreVersion("clipboard", 2, [
    {
        fromVersion: 1,
        migrate: (v1Data: unknown) => ({
            ...(v1Data as Record<string, unknown>),
            _migratedToV2: true,
            _migratedAt: Date.now(),
        }),
    },
]);
registerStoreVersion("category", 2, []);
registerStoreVersion("settings", 2, []);
registerStoreVersion("stats", 3, [
    {
        fromVersion: 2,
        migrate: (v2Data: unknown) => migrateStatsV2ToV3(v2Data),
    },
]);

function migrateStatsV2ToV3(v2Data: unknown): unknown {
    const data = v2Data as Record<string, unknown>;

    return {
        ...data,
        launchEvents: Array.isArray(data.launchEvents) ? data.launchEvents : [],
        launchTrackingStartedAt:
            typeof data.launchTrackingStartedAt === "number" ? data.launchTrackingStartedAt : null,
        legacyUsageSnapshot: Array.isArray(data.legacyUsageSnapshot) ? data.legacyUsageSnapshot : [],
        _migratedToV3: true,
        _migratedAt: Date.now(),
    };
}
