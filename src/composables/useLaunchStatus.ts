import { ref, type Ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type LaunchStatus = "launching" | "success";

export interface UseLaunchStatusOptions {
    autoHideAfterLaunch?: Ref<boolean>;
}

export function useLaunchStatus(options: UseLaunchStatusOptions = {}) {
    const { autoHideAfterLaunch } = options;
    const launchStatusMap = ref<Map<string, LaunchStatus>>(new Map());

    function setLaunchStatus(itemId: string, status: LaunchStatus) {
        launchStatusMap.value.set(itemId, status);
        launchStatusMap.value = new Map(launchStatusMap.value);
        if (status === "success") {
            if (autoHideAfterLaunch?.value) {
                getCurrentWindow().hide();
            }
            setTimeout(() => {
                launchStatusMap.value.delete(itemId);
                launchStatusMap.value = new Map(launchStatusMap.value);
            }, 2000);
        }
    }

    function clearLaunchStatus(itemId: string) {
        launchStatusMap.value.delete(itemId);
        launchStatusMap.value = new Map(launchStatusMap.value);
    }

    function getLaunchStatus(itemId: string): LaunchStatus | undefined {
        return launchStatusMap.value.get(itemId);
    }

    function isLaunching(itemId: string): boolean {
        return launchStatusMap.value.get(itemId) === "launching";
    }

    function isSuccess(itemId: string): boolean {
        return launchStatusMap.value.get(itemId) === "success";
    }

    return {
        launchStatusMap,
        setLaunchStatus,
        clearLaunchStatus,
        getLaunchStatus,
        isLaunching,
        isSuccess,
    };
}

export type LaunchStatusComposable = ReturnType<typeof useLaunchStatus>;
