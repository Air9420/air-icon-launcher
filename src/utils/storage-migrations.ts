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
registerStoreVersion("stats", 4, [
    {
        fromVersion: 2,
        migrate: (v2Data: unknown) => migrateStatsV2ToV3(v2Data),
    },
    {
        fromVersion: 3,
        migrate: (v3Data: unknown) => migrateStatsV3ToV4(v3Data),
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

/**
 * v3 -> v4：引入独立持久化的终身启动计数表。
 *
 * 旧数据没有该字段，直接用现有事件流 + 旧版快照推导出计数起点，
 * 使升级瞬间「总次数」不跳变，之后不再随事件裁剪缩水。
 */
function migrateStatsV3ToV4(v3Data: unknown): unknown {
    const data = v3Data as Record<string, unknown>;
    const counts: Record<string, number> = {};
    const slotCounts: Record<string, Record<string, number>> = {};

    const getSlot = (timestamp: unknown): string => {
        const hour = new Date(typeof timestamp === "number" ? timestamp : Date.now()).getHours();
        if (hour >= 6 && hour < 12) return "morning";
        if (hour >= 12 && hour < 18) return "afternoon";
        if (hour >= 18 && hour < 23) return "evening";
        return "night";
    };

    const bump = (categoryId: unknown, itemId: unknown, amount: unknown, usedAt: unknown) => {
        if (typeof categoryId !== "string" || !categoryId) return;
        if (typeof itemId !== "string" || !itemId) return;
        if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return;
        const count = Math.floor(amount);
        const key = `${categoryId}:${itemId}`;
        counts[key] = (counts[key] ?? 0) + count;
        const slot = getSlot(usedAt);
        const entry = slotCounts[key] ?? { morning: 0, afternoon: 0, evening: 0, night: 0 };
        entry[slot] = (entry[slot] ?? 0) + count;
        slotCounts[key] = entry;
    };

    const legacySnapshot = Array.isArray(data.legacyUsageSnapshot) ? data.legacyUsageSnapshot : [];
    for (const record of legacySnapshot) {
        if (!record || typeof record !== "object") continue;
        const entry = record as Record<string, unknown>;
        bump(entry.categoryId, entry.itemId, entry.usageCount, entry.usedAt);
    }

    const launchEvents = Array.isArray(data.launchEvents) ? data.launchEvents : [];
    for (const record of launchEvents) {
        if (!record || typeof record !== "object") continue;
        const entry = record as Record<string, unknown>;
        bump(entry.categoryId, entry.itemId, 1, entry.usedAt);
    }

    return {
        ...data,
        lifetimeLaunchCounts: counts,
        lifetimeTimeSlotCounts: slotCounts,
        _migratedToV4: true,
        _migratedAt: Date.now(),
    };
}
