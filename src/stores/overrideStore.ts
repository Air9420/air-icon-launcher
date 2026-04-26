import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { createVersionedPersistConfig } from "../utils/versioned-persist";
import type { CategoryOverride, NormalizedApp } from "../utils/classification/types";

function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return (hash >>> 0).toString(36);
}

export function buildOverrideKeys(app: NormalizedApp): string[] {
    const keys: string[] = [];

    if (app.exeName) {
        keys.push(`exe:${app.exeName.toLowerCase()}`);

        if (app.publisherToken) {
            keys.push(`exe+publisher:${app.exeName.toLowerCase()}:${app.publisherToken}`);
        }
    }

    const fingerprint = simpleHash(
        app.nameTokens.join(" ") + "|" +
        app.pathTokens.slice(0, 3).join("/")
    );
    keys.push(`fingerprint:${fingerprint}`);

    return keys;
}

export function getEffectiveConfidence(override: CategoryOverride): number {
    const now = Date.now();
    const days = (now - override.lastUsedAt) / (24 * 60 * 60 * 1000);
    return override.confidence * Math.pow(override.decayFactor, days);
}

const MAX_OVERRIDES = 500;

export const useOverrideStore = defineStore(
    "override",
    () => {
        const categoryOverrides = ref<CategoryOverride[]>([]);

        const overrideMap = computed(() => {
            const map = new Map<string, CategoryOverride>();
            for (const override of categoryOverrides.value) {
                map.set(override.key, override);
            }
            return map;
        });

        function addOverride(override: Omit<CategoryOverride, "key"> & { key?: string }): void {
            const app = override as any;
            let key = override.key;

            if (!key && app.exeName !== undefined) {
                const normalizedApp: NormalizedApp = {
                    name: app.name || "",
                    path: app.path || "",
                    icon_base64: null,
                    source: "",
                    publisher: app.publisher || null,
                    nameTokens: app.nameTokens || [],
                    pathTokens: app.pathTokens || [],
                    publisherToken: app.publisherToken || null,
                    exeName: app.exeName || "",
                };
                const keys = buildOverrideKeys(normalizedApp);
                key = keys[0];
            }

            if (!key) return;

            const existingIndex = categoryOverrides.value.findIndex(o => o.key === key);
            if (existingIndex !== -1) {
                categoryOverrides.value[existingIndex] = {
                    ...categoryOverrides.value[existingIndex],
                    ...override,
                    key,
                };
                return;
            }

            categoryOverrides.value.unshift({ ...override, key } as CategoryOverride);

            if (categoryOverrides.value.length > MAX_OVERRIDES) {
                categoryOverrides.value = categoryOverrides.value.slice(0, MAX_OVERRIDES);
            }
        }

        function addOverrideForApp(
            app: NormalizedApp,
            categoryKey: string,
            source: "user" | "ai"
        ): void {
            const keys = buildOverrideKeys(app);
            const now = Date.now();

            for (const key of keys) {
                const existing = overrideMap.value.get(key);
                if (existing) {
                    existing.categoryKey = categoryKey;
                    existing.confidence = source === "user" ? 1.0 : 0.7;
                    existing.source = source;
                    existing.lastUsedAt = now;
                    existing.hitCount++;
                    existing.decayFactor = source === "user" ? 1.0 : 0.98;
                    return;
                }
            }

            addOverride({
                key: keys[0],
                categoryKey,
                confidence: source === "user" ? 1.0 : 0.7,
                source,
                createdAt: now,
                lastUsedAt: now,
                hitCount: 0,
                decayFactor: source === "user" ? 1.0 : 0.98,
            });
        }

        function removeOverride(key: string): void {
            categoryOverrides.value = categoryOverrides.value.filter(o => o.key !== key);
        }

        function lookupOverride(app: NormalizedApp): CategoryOverride | null {
            const keys = buildOverrideKeys(app);
            for (const key of keys) {
                const override = overrideMap.value.get(key);
                if (override) {
                    const effective = getEffectiveConfidence(override);
                    if (effective >= 0.3) {
                        return override;
                    }
                }
            }
            return null;
        }

        function recordOverrideHit(app: NormalizedApp): void {
            const keys = buildOverrideKeys(app);
            for (const key of keys) {
                const override = categoryOverrides.value.find(o => o.key === key);
                if (override) {
                    override.hitCount++;
                    override.lastUsedAt = Date.now();
                    return;
                }
            }
        }

        function cleanupExpiredOverrides(): void {
            const now = Date.now();
            categoryOverrides.value = categoryOverrides.value.filter(override => {
                const effective = getEffectiveConfidence(override);
                if (effective < 0.3 && override.source === "ai") return false;
                if (override.source === "ai" && (now - override.createdAt) > 90 * 24 * 60 * 60 * 1000) return false;
                return true;
            });
        }

        function getOverrideStats(): { total: number; user: number; ai: number; expired: number } {
            let user = 0;
            let ai = 0;
            let expired = 0;
            for (const override of categoryOverrides.value) {
                if (override.source === "user") user++;
                else {
                    ai++;
                    if (getEffectiveConfidence(override) < 0.3) expired++;
                }
            }
            return { total: categoryOverrides.value.length, user, ai, expired };
        }

        return {
            categoryOverrides,
            addOverride,
            addOverrideForApp,
            removeOverride,
            lookupOverride,
            recordOverrideHit,
            cleanupExpiredOverrides,
            getOverrideStats,
            getEffectiveConfidence,
            buildOverrideKeys,
        };
    },
    {
        persist: createVersionedPersistConfig("override", [
            "categoryOverrides",
        ]),
    }
);
