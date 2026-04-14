import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { showToast } from "../composables/useGlobalToast";
import { Store, type LauncherItem } from "../stores";
import {
    executeLauncherItemWithDependencies,
    type ExecuteLauncherItemResult,
    type ExecutableLauncherItem,
    type LauncherItemRef,
} from "./launcher-executor";

export interface LaunchStoredItemOptions {
    store?: ReturnType<typeof Store>;
    notifyError?: boolean;
    recordUsage?: boolean;
    launchItem?: (item: ExecutableLauncherItem, ref: LauncherItemRef) => Promise<void>;
    wait?: (ms: number) => Promise<void>;
}

export function ensureUrlProtocol(url: string): string {
    if (url.startsWith("http://") || url.startsWith("https://")) {
        return url;
    }
    return `https://${url}`;
}

export async function launchWithSystemOpener(
    item: Pick<LauncherItem, "itemType" | "url" | "path">
): Promise<void> {
    if (item.itemType === "url" && item.url) {
        await openUrl(ensureUrlProtocol(item.url));
        return;
    }

    if (item.path) {
        await openPath(item.path);
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
    const store = options.store ?? Store();
    const notifyError = options.notifyError ?? false;
    const recordUsage = options.recordUsage ?? true;
    const launchItem = options.launchItem ?? ((item) => launchWithSystemOpener(item));

    try {
        const result = await executeLauncherItemWithDependencies({
            target: ref,
            getItem: (categoryId, itemId) => store.getLauncherItemById(categoryId, itemId),
            launchItem,
            wait: options.wait,
        });

        if (recordUsage) {
            store.recordItemUsage(ref.categoryId, ref.itemId);
        }

        return result;
    } catch (error) {
        if (notifyError) {
            showToast(getLauncherExecutionErrorMessage(error), { type: "error" });
        }
        throw error;
    }
}
