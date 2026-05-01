import { defineStore } from "pinia";
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { invokeOrThrow } from "../utils/invoke-wrapper";
import { getAppConfig, saveAppConfigPatch, type AppConfigSnapshot } from "../utils/config-sync";
import { createVersionedPersistConfig } from "../utils/versioned-persist";
import { useUIStore } from "./uiStore";
import { useClipboardStore } from "./clipboardStore";

export type ThemeMode = "light" | "dark" | "system" | "transparent";
export type CornerHotspotPosition =
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right";
export type CornerHotspotSensitivity = "low" | "medium" | "high";

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

type SetWindowEffectTypeOptions = {
    applyRuntime?: boolean;
};

function normalizeThemeMode(theme: string | null | undefined): ThemeMode {
    return theme === "light" || theme === "dark" || theme === "transparent"
        ? theme
        : "system";
}

function normalizeFollowMouseAnchor(
    anchor: string | null | undefined
): "top" | "center" | "bottom" {
    return anchor === "top" || anchor === "bottom" ? anchor : "center";
}

function normalizeWindowEffectType(type: string | null | undefined): WindowEffectType {
    return type === "acrylic" ? "acrylic" : "blur";
}

function normalizeCornerHotspotPosition(
    position: string | null | undefined
): CornerHotspotPosition {
    if (
        position === "top-left"
        || position === "top-right"
        || position === "bottom-left"
        || position === "bottom-right"
    ) {
        return position;
    }
    return "top-right";
}

function normalizeCornerHotspotSensitivity(
    sensitivity: string | null | undefined
): CornerHotspotSensitivity {
    if (sensitivity === "low" || sensitivity === "high") {
        return sensitivity;
    }
    return "medium";
}

export const useSettingsStore = defineStore(
    "settings",
    () => {
        const theme = ref<ThemeMode>("system");
        const windowEffectsEnabled = ref<boolean>(true);
        const ctrlDragEnabled = ref<boolean>(true);
        const autoHideAfterLaunch = ref<boolean>(false);
        const showGuideOnStartup = ref<boolean>(true);
        const cornerHotspotEnabled = ref<boolean>(false);
        const cornerHotspotPosition = ref<CornerHotspotPosition>("top-right");
        const cornerHotspotSensitivity = ref<CornerHotspotSensitivity>("medium");
        const toggleShortcut = ref<string>("alt+space");
        const clipboardShortcut = ref<string>("alt+v");
        const displayShortcut = ref<string>("");
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

        async function persistWindowEffectPreferences() {
            await saveAppConfigPatch({
                theme: theme.value,
                performance_mode: performanceMode.value,
                window_effect_type: windowEffectType.value,
            });
        }

        async function pushCornerHotspotRuntime(
            overrides: Partial<{
                enabled: boolean;
                position: CornerHotspotPosition;
                sensitivity: CornerHotspotSensitivity;
            }> = {}
        ) {
            await invokeOrThrow("set_corner_hotspot_config", {
                enabled: overrides.enabled ?? cornerHotspotEnabled.value,
                position: overrides.position ?? cornerHotspotPosition.value,
                sensitivity: overrides.sensitivity ?? cornerHotspotSensitivity.value,
            });
        }

        async function setTheme(newTheme: ThemeMode) {
            theme.value = newTheme;
            await saveAppConfigPatch({ theme: newTheme });
        }

        async function setCtrlDragEnabled(enabled: boolean) {
            await saveAppConfigPatch({ ctrl_drag_enabled: enabled });
            ctrlDragEnabled.value = enabled;
        }

        async function setAutoHideAfterLaunch(enabled: boolean) {
            await saveAppConfigPatch({ auto_hide_after_launch: enabled });
            autoHideAfterLaunch.value = enabled;
        }

        async function setShowGuideOnStartup(show: boolean) {
            await saveAppConfigPatch({ show_guide_on_startup: show });
            showGuideOnStartup.value = show;
        }

        async function setCornerHotspotEnabled(enabled: boolean) {
            try {
                await pushCornerHotspotRuntime({ enabled });
                await saveAppConfigPatch({ corner_hotspot_enabled: enabled });
                cornerHotspotEnabled.value = enabled;
            } catch (e) {
                console.error(e);
                throw e;
            }
        }

        async function setCornerHotspotPosition(position: CornerHotspotPosition) {
            try {
                await pushCornerHotspotRuntime({ position });
                await saveAppConfigPatch({ corner_hotspot_position: position });
                cornerHotspotPosition.value = position;
            } catch (e) {
                console.error(e);
                throw e;
            }
        }

        async function setCornerHotspotSensitivity(sensitivity: CornerHotspotSensitivity) {
            try {
                await pushCornerHotspotRuntime({ sensitivity });
                await saveAppConfigPatch({ corner_hotspot_sensitivity: sensitivity });
                cornerHotspotSensitivity.value = sensitivity;
            } catch (e) {
                console.error(e);
                throw e;
            }
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

        async function setDisplayShortcut(shortcut: string) {
            const next = shortcut.trim();
            if (!next) return;
            try {
                await invokeOrThrow("set_display_shortcut", { shortcut: next });
                await saveAppConfigPatch({ display_shortcut: next });
                displayShortcut.value = next;
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

            theme.value = normalizeThemeMode(config.theme);
            ctrlDragEnabled.value = config.ctrl_drag_enabled ?? true;
            autoHideAfterLaunch.value = config.auto_hide_after_launch ?? false;
            showGuideOnStartup.value = config.show_guide_on_startup ?? true;
            hideOnCtrlRightClick.value = config.hide_on_ctrl_right_click ?? false;
            cornerHotspotEnabled.value = config.corner_hotspot_enabled ?? false;
            cornerHotspotPosition.value = normalizeCornerHotspotPosition(
                config.corner_hotspot_position
            );
            cornerHotspotSensitivity.value = normalizeCornerHotspotSensitivity(
                config.corner_hotspot_sensitivity
            );
            toggleShortcut.value = config.toggle_shortcut || "alt+space";
            clipboardShortcut.value = config.clipboard_shortcut || "alt+v";
            displayShortcut.value = config.display_shortcut || "";
            followMouseOnShow.value = !!config.follow_mouse_on_show;
            followMouseYAnchor.value = normalizeFollowMouseAnchor(config.follow_mouse_y_anchor);
            performanceMode.value = config.performance_mode ?? false;
            windowEffectsEnabled.value = !performanceMode.value;
            windowEffectType.value = normalizeWindowEffectType(config.window_effect_type);
            strongShortcutMode.value = config.strong_shortcut_mode ?? true;

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

        async function setHideOnCtrlRightClick(enabled: boolean) {
            await saveAppConfigPatch({ hide_on_ctrl_right_click: enabled });
            hideOnCtrlRightClick.value = enabled;
        }

        function setWindowPosition(position: WindowPosition | null) {
            windowPosition.value = position;
        }

        async function refreshWindowEffectSupport(): Promise<WindowEffectSupportInfo | null> {
            try {
                const support = await invokeOrThrow<WindowEffectSupportInfo>(
                    "get_window_effect_support_info"
                );
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
            const previousTheme = theme.value;
            const previousPerformanceMode = performanceMode.value;
            const nextTheme = previousTheme === "transparent" ? "system" : previousTheme;
            const shouldPersist =
                nextTheme !== previousTheme || previousPerformanceMode !== true;

            theme.value = nextTheme;
            await invokeOrThrow("set_window_effects", { enabled: false });
            windowEffectsEnabled.value = false;
            performanceMode.value = true;

            if (shouldPersist) {
                await persistWindowEffectPreferences();
            }
        }

        async function applyResolvedWindowEffect(
            preferredType: WindowEffectType
        ): Promise<WindowEffectCompatibilityResult> {
            const support = await refreshWindowEffectSupport();
            const preferredSupported =
                preferredType === "blur"
                    ? support?.blurSupported ?? true
                    : support?.acrylicSupported ?? true;

            if (preferredSupported) {
                const shouldPersist =
                    performanceMode.value || windowEffectType.value !== preferredType;
                await invokeOrThrow("set_window_effect_type", { effectType: preferredType });
                windowEffectsEnabled.value = true;
                performanceMode.value = false;
                windowEffectType.value = preferredType;
                if (shouldPersist) {
                    await persistWindowEffectPreferences();
                }
                return {
                    changed: false,
                    action: "unchanged",
                    resolvedEffectType: preferredType,
                    support,
                };
            }

            const fallbackType = normalizeFallbackEffectType(support?.fallbackEffectType ?? null);
            if (fallbackType) {
                const shouldPersist =
                    performanceMode.value || windowEffectType.value !== preferredType;
                await invokeOrThrow("set_window_effect_type", { effectType: fallbackType });
                windowEffectsEnabled.value = true;
                performanceMode.value = false;
                // Keep the stored preference as the user's chosen effect type.
                // The runtime may temporarily fall back to a safer effect, but export/import
                // should preserve the original preference instead of rewriting it.
                windowEffectType.value = preferredType;
                if (shouldPersist) {
                    await persistWindowEffectPreferences();
                }
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
                await disableWindowEffectsInternal();
                return {
                    changed: false,
                    action: "performance-mode",
                    resolvedEffectType: null,
                    support,
                };
            }

            return applyResolvedWindowEffect(windowEffectType.value);
        }

        async function setPerformanceMode(
            enabled: boolean
        ): Promise<WindowEffectCompatibilityResult> {
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

        async function setWindowEffectType(
            type: WindowEffectType,
            options: SetWindowEffectTypeOptions = {}
        ): Promise<WindowEffectCompatibilityResult> {
            try {
                if (options.applyRuntime === false) {
                    const shouldPersist = windowEffectType.value !== type;
                    windowEffectType.value = type;
                    if (shouldPersist) {
                        await persistWindowEffectPreferences();
                    }
                    return {
                        changed: false,
                        action: "unchanged",
                        resolvedEffectType: performanceMode.value ? null : type,
                        support: windowEffectSupport.value,
                    };
                }
                return await applyResolvedWindowEffect(type);
            } catch (e) {
                console.error(e);
                throw e;
            }
        }

        async function setStrongShortcutMode(enabled: boolean) {
            try {
                await invokeOrThrow("set_strong_shortcut_mode", { enabled });
                await saveAppConfigPatch({ strong_shortcut_mode: enabled });
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
            displayShortcut,
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
            setCtrlDragEnabled,
            setAutoHideAfterLaunch,
            setShowGuideOnStartup,
            setCornerHotspotEnabled,
            setCornerHotspotPosition,
            setCornerHotspotSensitivity,
            setToggleShortcut,
            setClipboardShortcut,
            setDisplayShortcut,
            setFollowMouseOnShow,
            setFollowMouseYAnchor,
            applyPersistedConfig,
            hydratePersistedConfig,
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
    {
        persist: createVersionedPersistConfig("settings", [
            "theme",
            "ctrlDragEnabled",
            "autoHideAfterLaunch",
            "showGuideOnStartup",
            "cornerHotspotEnabled",
            "cornerHotspotPosition",
            "cornerHotspotSensitivity",
            "toggleShortcut",
            "clipboardShortcut",
            "displayShortcut",
            "followMouseOnShow",
            "followMouseYAnchor",
            "hideOnCtrlRightClick",
            "windowPosition",
            "performanceMode",
            "windowEffectType",
            "strongShortcutMode",
        ]),
    }
);
