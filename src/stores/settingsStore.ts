import { defineStore } from "pinia";
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { invokeOrThrow } from "../utils/invoke-wrapper";
import { getAppConfig, saveAppConfigPatch, type AppConfigSnapshot } from "../utils/config-sync";
import { createVersionedPersistConfig } from "../utils/versioned-persist";
import { useUIStore } from "./uiStore";
import { useClipboardStore } from "./clipboardStore";

export type ThemeMode = "light" | "dark" | "system" | "transparent";

type AppSettings = {
    toggle_shortcut: string;
    follow_mouse_on_show: boolean;
    follow_mouse_y_anchor: "top" | "center" | "bottom";
};

export type AutostartType = "Service" | "Registry" | "TaskScheduler";

export type AutostartStatus = {
    enabled: boolean;
    method: AutostartType | null;
};

export type WindowPosition = {
    x: number;
    y: number;
    monitorId: string | null;
    monitorName?: string;
    savedAt: number;
};

export type WindowEffectType = "blur" | "acrylic";

export type WindowEffectSupportInfo = {
    supported: boolean;
    blurSupported: boolean;
    acrylicSupported: boolean;
    fallbackEffectType: WindowEffectType | null;
    message: string | null;
    productName: string | null;
    displayVersion: string | null;
    buildNumber: number | null;
};

export type WindowEffectCompatibilityAction =
    | "unchanged"
    | "switched-effect"
    | "enabled-performance"
    | "performance-mode";

export type WindowEffectCompatibilityResult = {
    changed: boolean;
    action: WindowEffectCompatibilityAction;
    message?: string;
    resolvedEffectType: WindowEffectType | null;
    support: WindowEffectSupportInfo | null;
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
        const windowPosition = ref<WindowPosition | null>(null);
        const performanceMode = ref<boolean>(false);
        const windowEffectType = ref<WindowEffectType>("blur");
        const windowEffectSupport = ref<WindowEffectSupportInfo | null>(null);
        const strongShortcutMode = ref<boolean>(true);

        async function setTheme(newTheme: ThemeMode) {
            theme.value = newTheme;
            await saveAppConfigPatch({ theme: newTheme });
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
                await invokeOrThrow("set_toggle_shortcut", { shortcut: next });
                await saveAppConfigPatch({ toggle_shortcut: next });
                toggleShortcut.value = next;
            } catch (e) {
                console.error(e);
                throw e;
            }
        }

        async function setClipboardShortcut(shortcut: string) {
            const next = shortcut.trim();
            if (!next) return;
            try {
                await invokeOrThrow("set_clipboard_shortcut", { shortcut: next });
                await saveAppConfigPatch({ clipboard_shortcut: next });
                clipboardShortcut.value = next;
            } catch (e) {
                console.error(e);
                throw e;
            }
        }

        async function setFollowMouseOnShow(enabled: boolean) {
            try {
                await invokeOrThrow("set_follow_mouse_on_show", { enabled });
                await saveAppConfigPatch({ follow_mouse_on_show: enabled });
                followMouseOnShow.value = enabled;
            } catch (e) {
                console.error(e);
                throw e;
            }
        }

        async function setFollowMouseYAnchor(anchor: "top" | "center" | "bottom") {
            try {
                await invokeOrThrow("set_follow_mouse_y_anchor", { anchor });
                await saveAppConfigPatch({ follow_mouse_y_anchor: anchor });
                followMouseYAnchor.value = anchor;
            } catch (e) {
                console.error(e);
                throw e;
            }
        }

        function applyPersistedConfig(config: AppConfigSnapshot) {
            const uiStore = useUIStore();
            const clipboardStore = useClipboardStore();
            theme.value = (config.theme as ThemeMode) || "system";
            uiStore.setCategoryCols(config.category_cols);
            uiStore.setLauncherCols(config.launcher_cols);
            uiStore.setHomeSectionLayouts(config.home_section_layouts);
            clipboardStore.setClipboardHistoryEnabled(config.clipboard_history_enabled);
            clipboardStore.setMaxRecords(config.clipboard_max_records);
        }

        async function hydratePersistedConfig() {
            try {
                const config = await getAppConfig();
                applyPersistedConfig(config);
            } catch (e) {
                console.error(e);
            }
        }

        async function hydrateAppSettings() {
            try {
                const settings = await invoke<AppSettings>("get_app_settings");
                if (!settings) return;

                toggleShortcut.value = settings?.toggle_shortcut || "alt+space";
                followMouseOnShow.value = !!settings?.follow_mouse_on_show;
                followMouseYAnchor.value = settings?.follow_mouse_y_anchor || "center";
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
                await invokeOrThrow("set_autostart", { method, enabled });
                await refreshAutostartStatus();
            } catch (e: unknown) {
                const message =
                    typeof e === "string"
                        ? e
                        : e instanceof Error && e.message
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

        function setWindowPosition(position: WindowPosition | null) {
            windowPosition.value = position;
        }

        async function refreshWindowEffectSupport(): Promise<WindowEffectSupportInfo | null> {
            try {
                const support = await invokeOrThrow<WindowEffectSupportInfo>("get_window_effect_support_info");
                windowEffectSupport.value = support;
                return support;
            } catch (e) {
                console.error(e);
                return null;
            }
        }

        function normalizeFallbackEffectType(type: string | null): WindowEffectType | null {
            return type === "blur" || type === "acrylic" ? type : null;
        }

        function getWindowEffectLabel(type: WindowEffectType) {
            return type === "acrylic" ? "Acrylic" : "Blur";
        }

        function buildCompatibilityMessage(
            support: WindowEffectSupportInfo | null,
            preferredType: WindowEffectType,
            resolvedEffectType: WindowEffectType | null
        ) {
            if (support?.message?.trim()) {
                return support.message.trim();
            }

            if (resolvedEffectType) {
                return `当前系统不建议启用 ${getWindowEffectLabel(preferredType)}，已自动切换为 ${getWindowEffectLabel(resolvedEffectType)}。`;
            }

            return "当前系统对窗口特效兼容性较差，已自动切换到性能模式。建议升级到较新的 Windows 10 / 11。";
        }

        async function disableWindowEffectsInternal() {
            if (theme.value === "transparent") {
                theme.value = "system";
            }
            await invokeOrThrow("set_window_effects", { enabled: false });
            windowEffectsEnabled.value = false;
            performanceMode.value = true;
        }

        async function applyResolvedWindowEffect(
            preferredType: WindowEffectType
        ): Promise<WindowEffectCompatibilityResult> {
            const support = await refreshWindowEffectSupport();
            const preferredSupported = preferredType === "blur"
                ? support?.blurSupported ?? true
                : support?.acrylicSupported ?? true;

            if (preferredSupported) {
                await invokeOrThrow("set_window_effect_type", { effectType: preferredType });
                windowEffectsEnabled.value = true;
                performanceMode.value = false;
                windowEffectType.value = preferredType;
                return {
                    changed: false,
                    action: "unchanged",
                    resolvedEffectType: preferredType,
                    support,
                };
            }

            const fallbackType = normalizeFallbackEffectType(support?.fallbackEffectType ?? null);
            if (fallbackType) {
                await invokeOrThrow("set_window_effect_type", { effectType: fallbackType });
                windowEffectsEnabled.value = true;
                performanceMode.value = false;
                windowEffectType.value = fallbackType;
                return {
                    changed: true,
                    action: "switched-effect",
                    message: buildCompatibilityMessage(support, preferredType, fallbackType),
                    resolvedEffectType: fallbackType,
                    support,
                };
            }

            await disableWindowEffectsInternal();
            return {
                changed: true,
                action: "enabled-performance",
                message: buildCompatibilityMessage(support, preferredType, null),
                resolvedEffectType: null,
                support,
            };
        }

        async function applyCurrentWindowEffectState(): Promise<WindowEffectCompatibilityResult> {
            const support = await refreshWindowEffectSupport();

            if (performanceMode.value) {
                await invokeOrThrow("set_window_effects", { enabled: false });
                windowEffectsEnabled.value = false;
                return {
                    changed: false,
                    action: "performance-mode",
                    resolvedEffectType: null,
                    support,
                };
            }

            return applyResolvedWindowEffect(windowEffectType.value);
        }

        async function setPerformanceMode(enabled: boolean): Promise<WindowEffectCompatibilityResult> {
            try {
                if (enabled) {
                    const changed = !performanceMode.value || windowEffectsEnabled.value;
                    await disableWindowEffectsInternal();
                    return {
                        changed,
                        action: "enabled-performance",
                        resolvedEffectType: null,
                        support: windowEffectSupport.value,
                    };
                }

                return await applyResolvedWindowEffect(windowEffectType.value);
            } catch (e) {
                console.error(e);
                throw e;
            }
        }

        async function setWindowEffectType(type: WindowEffectType): Promise<WindowEffectCompatibilityResult> {
            try {
                return await applyResolvedWindowEffect(type);
            } catch (e) {
                console.error(e);
                throw e;
            }
        }

        async function setStrongShortcutMode(enabled: boolean) {
            try {
                await invokeOrThrow("set_strong_shortcut_mode", { enabled });
                strongShortcutMode.value = enabled;
            } catch (e) {
                console.error(e);
                throw e;
            }
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
            windowPosition,
            performanceMode,
            windowEffectType,
            windowEffectSupport,
            strongShortcutMode,
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
            applyPersistedConfig,
            hydratePersistedConfig,
            hydrateAppSettings,
            refreshAutostartStatus,
            setAutostartEnabled,
            setHideOnCtrlRightClick,
            setWindowPosition,
            refreshWindowEffectSupport,
            applyCurrentWindowEffectState,
            setPerformanceMode,
            setWindowEffectType,
            setStrongShortcutMode,
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
        "windowPosition",
        "performanceMode",
        "windowEffectType",
        "strongShortcutMode",
    ]) }
);
