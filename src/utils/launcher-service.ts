import { showToast } from "../composables/useGlobalToast";
import { Store, type LauncherItem } from "../stores";
import {
    executeLauncherItemWithDependencies,
    type ExecuteLauncherItemResult,
    type ExecutableLauncherItem,
    type LauncherItemRef,
} from "./launcher-executor";
import { openPathWithSystem, openUrlWithSystem } from "./system-commands";

export interface LaunchStoredItemOptions {
    /** Pinia adapter fallback when getItem/onRecordUsage are not provided. */
    store?: ReturnType<typeof Store>;
    /**
     * Preferred lookups for Cordis AppsService — avoids kernel → pinia import.
     * When set, `store` is unused for these operations.
     */
    getItem?: (categoryId: string, itemId: string) => ExecutableLauncherItem | null;
    onRecordUsage?: (categoryId: string, itemId: string) => void;
    notifyError?: boolean;
    recordUsage?: boolean;
    launchItem?: (item: ExecutableLauncherItem, ref: LauncherItemRef) => Promise<void>;
    wait?: (ms: number) => Promise<void>;
}

export function ensureUrlProtocol(url: string): string {
    const trimmed = url.trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
        return url;
    }
    return `https://${url}`;
}

export async function launchWithSystemOpener(
    item: Pick<LauncherItem, "itemType" | "url" | "path">
): Promise<void> {
    if (item.itemType === "url" && item.url) {
        await openUrlWithSystem(ensureUrlProtocol(item.url));
        return;
    }

    if (item.path) {
        await openPathWithSystem(item.path);
        return;
    }

    throw new Error("No path or URL available");
}

export function getLauncherExecutionErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return String(error);
}

export async function launchStoredItem(
    ref: LauncherItemRef,
    options: LaunchStoredItemOptions = {}
): Promise<ExecuteLauncherItemResult> {
    const notifyError = options.notifyError ?? false;
    const recordUsage = options.recordUsage ?? true;
    const launchItem = options.launchItem ?? ((item) => launchWithSystemOpener(item));

    // Prefer explicit callbacks (AppsService); fall back to pinia store adapter.
    const getItem =
        options.getItem ??
        ((categoryId: string, itemId: string) => {
            const store = options.store ?? Store();
            return store.getLauncherItemById(categoryId, itemId);
        });
    const onRecordUsage =
        options.onRecordUsage ??
        ((categoryId: string, itemId: string) => {
            const store = options.store ?? Store();
            store.recordItemUsage(categoryId, itemId);
        });

    const getExecutablePath = (item: ExecutableLauncherItem): string | null => {
        if (item.itemType === "url") return null;
        return item.resolvedPath || item.path || null;
    };

    try {
        const result = await executeLauncherItemWithDependencies({
            target: ref,
            getItem,
            launchItem,
            getExecutablePath,
            wait: options.wait,
        });

        if (recordUsage) {
            onRecordUsage(ref.categoryId, ref.itemId);
        }

        return result;
    } catch (error) {
        if (notifyError) {
            showToast(getLauncherExecutionErrorMessage(error), { type: "error" });
        }
        throw error;
    }
}
