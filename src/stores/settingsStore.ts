import { defineStore } from "pinia";
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { invoke as safeInvoke } from "../utils/invoke-wrapper";
import { createVersionedPersistConfig } from "../utils/versioned-persist";

export type ThemeMode = "light" | "dark" | "system" | "transparent";

type AppSettings = {
    toggle_shortcut: string;
    follow_mouse_on_show: boolean;
    follow_mouse_y_anchor: "top" | "center" | "bottom";
};

type AutostartServiceStatus = {
    installed: boolean;
};

export type AutostartType = "Service" | "Registry" | "TaskScheduler";

export type AutostartStatus = {
    enabled: boolean;
    method: AutostartType | null;
};

export const useSettingsStore = defineStore(
    "settings",
    () => {
        const theme = ref<ThemeMode>("system");
        const windowEffectsEnabled = ref<boolean>(true);
        const ctrlDragEnabled = ref<boolean>(true);
        const autoHideAfterLaunch = ref<boolean>(false);
        const showGuideOnStartup = ref<boolean>(true);
        const cornerHotspotEnabled = ref<boolean>(false);
        const cornerHotspotPosition = ref<"top-left" | "top-right" | "bottom-left" | "bottom-right">("top-right");
        const cornerHotspotSensitivity = ref<"low" | "medium" | "high">("medium");
        const toggleShortcut = ref<string>("alt+space");
        const clipboardShortcut = ref<string>("alt+v");
        const followMouseOnShow = ref<boolean>(false);
        const followMouseYAnchor = ref<"top" | "center" | "bottom">("center");
        const autostartEnabled = ref<boolean>(false);
        const autostartMethod = ref<AutostartType | null>(null);
        const autostartLoading = ref<boolean>(false);
        const autostartError = ref<string>("");
        const hideOnCtrlRightClick = ref<boolean>(false);

        function setTheme(newTheme: ThemeMode) {
            theme.value = newTheme;
        }

        function setWindowEffectsEnabled(enabled: boolean) {
            windowEffectsEnabled.value = enabled;
        }

        function setCtrlDragEnabled(enabled: boolean) {
            ctrlDragEnabled.value = enabled;
        }

        function setAutoHideAfterLaunch(enabled: boolean) {
            autoHideAfterLaunch.value = enabled;
        }

        function setShowGuideOnStartup(show: boolean) {
            showGuideOnStartup.value = show;
        }

        function setCornerHotspotEnabled(enabled: boolean) {
            cornerHotspotEnabled.value = enabled;
        }

        function setCornerHotspotPosition(position: "top-left" | "top-right" | "bottom-left" | "bottom-right") {
            cornerHotspotPosition.value = position;
        }

        function setCornerHotspotSensitivity(sensitivity: "low" | "medium" | "high") {
            cornerHotspotSensitivity.value = sensitivity;
        }

        async function setToggleShortcut(shortcut: string) {
            const next = shortcut.trim();
            if (!next) return;
            try {
                await safeInvoke("set_toggle_shortcut", { shortcut: next });
                toggleShortcut.value = next;
            } catch (e) {
                console.error(e);
            }
        }

        async function setClipboardShortcut(shortcut: string) {
            const next = shortcut.trim();
            if (!next) return;
            try {
                await safeInvoke("set_clipboard_shortcut", { shortcut: next });
                clipboardShortcut.value = next;
            } catch (e) {
                console.error(e);
                throw e;
            }
        }

        async function setFollowMouseOnShow(enabled: boolean) {
            try {
                await safeInvoke("set_follow_mouse_on_show", { enabled });
                followMouseOnShow.value = enabled;
            } catch (e) {
                console.error(e);
            }
        }

        async function setFollowMouseYAnchor(anchor: "top" | "center" | "bottom") {
            try {
                await safeInvoke("set_follow_mouse_y_anchor", { anchor });
                followMouseYAnchor.value = anchor;
            } catch (e) {
                console.error(e);
            }
        }

        async function hydrateAppSettings() {
            try {
                const settings = await invoke<AppSettings>("get_app_settings");
                const backendShortcut = settings?.toggle_shortcut || "alt+space";
                const backendFollow = !!settings?.follow_mouse_on_show;
                const backendAnchor = settings?.follow_mouse_y_anchor || "center";

                const desiredShortcut = toggleShortcut.value?.trim() || backendShortcut;
                const desiredFollow = !!followMouseOnShow.value;
                const desiredAnchor = followMouseYAnchor.value || backendAnchor;

                if (desiredShortcut !== backendShortcut) {
                    await safeInvoke("set_toggle_shortcut", { shortcut: desiredShortcut });
                    toggleShortcut.value = desiredShortcut;
                } else {
                    toggleShortcut.value = backendShortcut;
                }

                if (desiredFollow !== backendFollow) {
                    await safeInvoke("set_follow_mouse_on_show", { enabled: desiredFollow });
                } else {
                    followMouseOnShow.value = backendFollow;
                }

                if (desiredAnchor !== backendAnchor) {
                    await safeInvoke("set_follow_mouse_y_anchor", { anchor: desiredAnchor });
                    followMouseYAnchor.value = desiredAnchor;
                } else {
                    followMouseYAnchor.value = backendAnchor;
                }
            } catch (e) {
                console.error(e);
            }
        }

        async function refreshAutostartStatus() {
            autostartError.value = "";
            try {
                const status = await invoke<AutostartStatus>("get_autostart_status");
                autostartEnabled.value = status?.enabled ?? false;
                autostartMethod.value = status?.method ?? null;
            } catch (e) {
                autostartError.value = "无法获取开机自启状态";
                console.error(e);
            }
        }

        async function setAutostartEnabled(enabled: boolean, method: AutostartType) {
            autostartLoading.value = true;
            autostartError.value = "";
            try {
                await safeInvoke("set_autostart", { method, enabled });
                await refreshAutostartStatus();
            } catch (e: any) {
                const message =
                    typeof e === "string"
                        ? e
                        : e?.message
                          ? String(e.message)
                          : "开机自启设置失败";
                autostartError.value = message;
                console.error(e);
                await refreshAutostartStatus();
            } finally {
                autostartLoading.value = false;
            }
        }

        function setHideOnCtrlRightClick(enabled: boolean) {
            hideOnCtrlRightClick.value = enabled;
        }

        return {
            theme,
            windowEffectsEnabled,
            ctrlDragEnabled,
            autoHideAfterLaunch,
            showGuideOnStartup,
            cornerHotspotEnabled,
            cornerHotspotPosition,
            cornerHotspotSensitivity,
            toggleShortcut,
            clipboardShortcut,
            followMouseOnShow,
            followMouseYAnchor,
            autostartEnabled,
            autostartMethod,
            autostartLoading,
            autostartError,
            hideOnCtrlRightClick,
            setTheme,
            setWindowEffectsEnabled,
            setCtrlDragEnabled,
            setAutoHideAfterLaunch,
            setShowGuideOnStartup,
            setCornerHotspotEnabled,
            setCornerHotspotPosition,
            setCornerHotspotSensitivity,
            setToggleShortcut,
            setClipboardShortcut,
            setFollowMouseOnShow,
            setFollowMouseYAnchor,
            hydrateAppSettings,
            refreshAutostartStatus,
            setAutostartEnabled,
            setHideOnCtrlRightClick,
        };
    },
    { persist: createVersionedPersistConfig("settings", [
        "theme",
        "windowEffectsEnabled",
        "ctrlDragEnabled",
        "autoHideAfterLaunch",
        "showGuideOnStartup",
        "cornerHotspotEnabled",
        "cornerHotspotPosition",
        "cornerHotspotSensitivity",
        "toggleShortcut",
        "clipboardShortcut",
        "followMouseOnShow",
        "followMouseYAnchor",
        "autostartEnabled",
        "autostartMethod",
        "hideOnCtrlRightClick",
    ]) as any }
);
