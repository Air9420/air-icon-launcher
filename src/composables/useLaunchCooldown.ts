import { ref } from "vue";

export interface UseLaunchCooldownOptions {
    cooldown?: number;
}

function extractItemId(args: unknown[]): string | null {
    if (args.length === 0) return null;

    const first = args[0];

    if (typeof first === "string") return first;

    if (first && typeof first === "object") {
        const obj = first as Record<string, unknown>;

        if (typeof obj.itemId === "string") return obj.itemId;
        if (obj.item && typeof obj.item === "object" && typeof (obj.item as Record<string, unknown>).id === "string") {
            return (obj.item as Record<string, unknown>).id as string;
        }
        if (obj.recent && typeof obj.recent === "object" && typeof (obj.recent as Record<string, unknown>).itemId === "string") {
            return (obj.recent as Record<string, unknown>).itemId as string;
        }
    }

    return null;
}

export function useLaunchCooldown(options: UseLaunchCooldownOptions = {}) {
    const cooldownMs = options.cooldown ?? 2500;
    const itemCooldowns = ref<Map<string, number>>(new Map());

    function pruneExpiredCooldowns(now: number = Date.now()) {
        for (const [itemId, timestamp] of itemCooldowns.value.entries()) {
            if (now - timestamp >= cooldownMs) {
                itemCooldowns.value.delete(itemId);
            }
        }
    }

    function isInCooldown(itemId: string): boolean {
        pruneExpiredCooldowns();
        const lastTime = itemCooldowns.value.get(itemId);
        if (!lastTime) return false;
        return Date.now() - lastTime < cooldownMs;
    }

    function exec<T extends (...args: unknown[]) => unknown>(
        itemId: string,
        fn: T,
        ...args: Parameters<T>
    ): boolean {
        pruneExpiredCooldowns();
        if (isInCooldown(itemId)) {
            return false;
        }
        itemCooldowns.value.set(itemId, Date.now());
        fn(...args);
        return true;
    }

    function createCooldown<T extends (...args: any[]) => any>(fn: T) {
        return (...args: Parameters<T>): boolean => {
            const itemId = extractItemId(args);
            if (!itemId) {
                fn(...args);
                return true;
            }
            return exec(itemId, fn, ...args);
        };
    }

    return {
        isInCooldown,
        exec,
        createCooldown,
        pruneExpiredCooldowns,
    };
}

export type LaunchCooldownComposable = ReturnType<typeof useLaunchCooldown>;
