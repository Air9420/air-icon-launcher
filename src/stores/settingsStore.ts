import { defineStore } from "pinia";
import { ref, type Ref } from "vue";
import { invokeOrThrow } from "../utils/invoke-wrapper";
import { getAppConfig, saveAppConfigPatch, type AppConfigSnapshot } from "../utils/config-sync";
import { createVersionedPersistConfig } from "../utils/versioned-persist";
import { useUIStore } from "./uiStore";
import { useClipboardStore } from "./clipboardStore";
import type { KernelContext } from "../kernel/types";
import type { SettingsService } from "../kernel/services/settings-service";
import type {
    ThemeService,
    ThemeMode,
    WindowEffectType as ThemeWindowEffectType,
    WindowEffectSupportInfo,
    WindowEffectCompatibilityResult,
} from "../kernel/services/theme-service";

export type { ThemeMode };
export type WindowEffectType = ThemeWindowEffectType;
export type { WindowEffectSupportInfo, WindowEffectCompatibilityResult };

function getKernel(): KernelContext | undefined {
    if (typeof window === "undefined") return undefined;
    return window.__AIR_CTX__ as KernelContext | undefined;
}

function getSettingsService(): SettingsService | undefined {
    return getKernel()?.settings;
}

function getThemeService(): ThemeService | undefined {
    return getKernel()?.theme;
}

/** patch_config via ctx.settings when available; config-sync fallback otherwise. */
async function patchAppConfig(partial: Partial<AppConfigSnapshot>): Promise<AppConfigSnapshot> {
    const settings = getSettingsService();
    if (settings) {
        const result = await settings.patch(partial);
        if (!result.ok) throw result.error;
        return result.value;
    }
    return saveAppConfigPatch(partial);
}

/**
 * Unified store write: optional runtime IPC → patch_config → assign ref.
 * Prefers SettingsService.applyTo; falls back to invoke-wrapper + config-sync.
 */
async function applySetting<T>(
    localRef: Ref<T>,
    value: T,
    configPatch: Partial<AppConfigSnapshot>,
    runtime?: () => Promise<void>,
): Promise<void> {
    const settings = getSettingsService();
    if (settings) {
        await settings.applyTo(localRef, value, configPatch, { runtime });
        return;
    }
    try {
        if (runtime) await runtime();
        await patchAppConfig(configPatch);
        localRef.value = value;
    } catch (e) {
        console.error(e);
        throw e;
    }
}

export type CornerHotspotPosition =
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right";
export type CornerHotspotSensitivity = "low" | "medium" | "high";
export type AutostartType = "Service" | "Registry" | "TaskScheduler";
export type AutostartStatus = { enabled: boolean; method: AutostartType | null };
export type WindowPosition = {
    x: number;
    y: number;
    monitorId: string | null;
    monitorName?: string;
    savedAt: number;
};

type SetWindowEffectTypeOptions = { applyRuntime?: boolean };

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
        // Share ThemeService refs when kernel is present (single source of truth).
        const themeService = getThemeService();
        const theme = themeService?.mode ?? ref<ThemeMode>("system");
        const windowEffectsEnabled =
            themeService?.windowEffectsEnabled ?? ref<boolean>(true);
        const performanceMode = themeService?.performanceMode ?? ref<boolean>(false);
        const windowEffectType =
            themeService?.windowEffectType ?? ref<WindowEffectType>("blur");
        const windowEffectSupport =
            themeService?.windowEffectSupport ?? ref<WindowEffectSupportInfo | null>(null);

        const ctrlDragEnabled = ref<boolean>(true);
        const autoHideAfterLaunch = ref<boolean>(false);
        const showGuideOnStartup = ref<boolean>(true);
        const cornerHotspotEnabled = ref<boolean>(false);
        const cornerHotspotPosition = ref<CornerHotspotPosition>("top-right");
        const cornerHotspotSensitivity = ref<CornerHotspotSensitivity>("medium");
        const toggleShortcut = ref<string>("alt+space");
        const clipboardShortcut = ref<string>("alt+v");
        const displayShortcut = ref<string>("");
        const iccShortcut = ref<string>("alt+i");
        const followMouseOnShow = ref<boolean>(false);
        const followMouseYAnchor = ref<"top" | "center" | "bottom">("center");
        const autostartEnabled = ref<boolean>(false);
        const autostartMethod = ref<AutostartType | null>(null);
        const autostartLoading = ref<boolean>(false);
        const autostartError = ref<string>("");
        const hideOnCtrlRightClick = ref<boolean>(false);
        const windowPosition = ref<WindowPosition | null>(null);
        const strongShortcutMode = ref<boolean>(true);
        const autoHideCountdownSeconds = ref<number>(30);
        const autoHideEnabled = ref<boolean>(true);

        async function setTheme(newTheme: ThemeMode) {
            const themeSvc = getThemeService();
            if (themeSvc) {
                const result = await themeSvc.setMode(newTheme);
                if (!result.ok) throw result.error;
                return;
            }
            theme.value = newTheme;
            await saveAppConfigPatch({ theme: newTheme });
        }

        async function setCtrlDragEnabled(enabled: boolean) {
            await applySetting(ctrlDragEnabled, enabled, { ctrl_drag_enabled: enabled });
        }

        async function setAutoHideAfterLaunch(enabled: boolean) {
            await applySetting(autoHideAfterLaunch, enabled, { auto_hide_after_launch: enabled });
        }

        async function setShowGuideOnStartup(show: boolean) {
            await applySetting(showGuideOnStartup, show, { show_guide_on_startup: show });
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

        async function setCornerHotspotEnabled(enabled: boolean) {
            await applySetting(
                cornerHotspotEnabled,
                enabled,
                { corner_hotspot_enabled: enabled },
                () => pushCornerHotspotRuntime({ enabled }),
            );
        }

        async function setCornerHotspotPosition(position: CornerHotspotPosition) {
            await applySetting(
                cornerHotspotPosition,
                position,
                { corner_hotspot_position: position },
                () => pushCornerHotspotRuntime({ position }),
            );
        }

        async function setCornerHotspotSensitivity(sensitivity: CornerHotspotSensitivity) {
            await applySetting(
                cornerHotspotSensitivity,
                sensitivity,
                { corner_hotspot_sensitivity: sensitivity },
                () => pushCornerHotspotRuntime({ sensitivity }),
            );
        }

        async function setToggleShortcut(shortcut: string) {
            const next = shortcut.trim();
            if (!next) return;
            await applySetting(
                toggleShortcut,
                next,
                { toggle_shortcut: next },
                () => invokeOrThrow("set_toggle_shortcut", { shortcut: next }),
            );
        }

        async function setClipboardShortcut(shortcut: string) {
            const next = shortcut.trim();
            if (!next) return;
            await applySetting(
                clipboardShortcut,
                next,
                { clipboard_shortcut: next },
                () => invokeOrThrow("set_clipboard_shortcut", { shortcut: next }),
            );
        }

        async function setDisplayShortcut(shortcut: string) {
            const next = shortcut.trim();
            if (!next) return;
            await applySetting(
                displayShortcut,
                next,
                { display_shortcut: next },
                () => invokeOrThrow("set_display_shortcut", { shortcut: next }),
            );
        }

        async function setIccShortcut(shortcut: string) {
            const next = shortcut.trim();
            if (!next) return;
            await applySetting(
                iccShortcut,
                next,
                { icc_shortcut: next },
                () => invokeOrThrow("set_icc_shortcut", { shortcut: next }),
            );
        }

        async function setFollowMouseOnShow(enabled: boolean) {
            await applySetting(
                followMouseOnShow,
                enabled,
                { follow_mouse_on_show: enabled },
                () => invokeOrThrow("set_follow_mouse_on_show", { enabled }),
            );
        }

        async function setFollowMouseYAnchor(anchor: "top" | "center" | "bottom") {
            await applySetting(
                followMouseYAnchor,
                anchor,
                { follow_mouse_y_anchor: anchor },
                () => invokeOrThrow("set_follow_mouse_y_anchor", { anchor }),
            );
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
            iccShortcut.value = config.icc_shortcut || "alt+i";
            followMouseOnShow.value = !!config.follow_mouse_on_show;
            followMouseYAnchor.value = normalizeFollowMouseAnchor(config.follow_mouse_y_anchor);
            performanceMode.value = config.performance_mode ?? false;
            windowEffectsEnabled.value = !performanceMode.value;
            windowEffectType.value = normalizeWindowEffectType(config.window_effect_type);
            strongShortcutMode.value = config.strong_shortcut_mode ?? true;
            autoHideCountdownSeconds.value = config.auto_hide_countdown_seconds ?? 30;
            autoHideEnabled.value = config.auto_hide_enabled ?? true;

            getThemeService()?.syncFromConfig(config);
            getSettingsService()?.applyLocal(config);

            uiStore.setCategoryCols(config.category_cols, { persist: false });
            uiStore.setLauncherCols(config.launcher_cols, { persist: false });
            uiStore.setHomeSectionLayouts(config.home_section_layouts, { persist: false });
            clipboardStore.clipboardHistoryEnabled = config.clipboard_history_enabled;
        }

        async function hydratePersistedConfig() {
            try {
                const settings = getSettingsService();
                let config: AppConfigSnapshot;
                if (settings) {
                    const result = await settings.hydrate();
                    if (!result.ok) throw result.error;
                    config = result.value;
                } else {
                    config = await getAppConfig();
                }
                applyPersistedConfig(config);
            } catch (e) {
                console.error(e);
            }
        }

        async function refreshAutostartStatus() {
            autostartError.value = "";
            try {
                const status = await invokeOrThrow<AutostartStatus>("get_autostart_status");
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
            await applySetting(hideOnCtrlRightClick, enabled, {
                hide_on_ctrl_right_click: enabled,
            });
        }

        function setWindowPosition(position: WindowPosition | null) {
            windowPosition.value = position;
        }

        // Window-effect matrix lives on ThemeService; store is a thin adapter.
        async function refreshWindowEffectSupport(): Promise<WindowEffectSupportInfo | null> {
            return getThemeService()?.refreshWindowEffectSupport() ?? null;
        }

        async function applyCurrentWindowEffectState(): Promise<WindowEffectCompatibilityResult> {
            const themeSvc = getThemeService();
            if (!themeSvc) {
                return {
                    changed: false,
                    action: "unchanged",
                    resolvedEffectType: performanceMode.value ? null : windowEffectType.value,
                    support: windowEffectSupport.value,
                };
            }
            return themeSvc.applyCurrentWindowEffectState();
        }

        async function setPerformanceMode(
            enabled: boolean
        ): Promise<WindowEffectCompatibilityResult> {
            const themeSvc = getThemeService();
            if (!themeSvc) {
                performanceMode.value = enabled;
                windowEffectsEnabled.value = !enabled;
                await patchAppConfig({
                    theme: theme.value,
                    performance_mode: enabled,
                    window_effect_type: windowEffectType.value,
                });
                return {
                    changed: true,
                    action: enabled ? "enabled-performance" : "unchanged",
                    resolvedEffectType: enabled ? null : windowEffectType.value,
                    support: windowEffectSupport.value,
                };
            }
            return themeSvc.setPerformanceMode(enabled);
        }

        async function setWindowEffectType(
            type: WindowEffectType,
            options: SetWindowEffectTypeOptions = {}
        ): Promise<WindowEffectCompatibilityResult> {
            const themeSvc = getThemeService();
            if (!themeSvc) {
                if (options.applyRuntime === false) {
                    windowEffectType.value = type;
                    await patchAppConfig({
                        theme: theme.value,
                        performance_mode: performanceMode.value,
                        window_effect_type: type,
                    });
                }
                return {
                    changed: false,
                    action: "unchanged",
                    resolvedEffectType: performanceMode.value ? null : type,
                    support: windowEffectSupport.value,
                };
            }
            return themeSvc.setWindowEffectType(type, options);
        }

        async function setStrongShortcutMode(enabled: boolean) {
            await applySetting(
                strongShortcutMode,
                enabled,
                { strong_shortcut_mode: enabled },
                () => invokeOrThrow("set_strong_shortcut_mode", { enabled }),
            );
        }

        async function setAutoHideCountdownSeconds(seconds: number) {
            await applySetting(autoHideCountdownSeconds, seconds, {
                auto_hide_countdown_seconds: seconds,
            });
        }

        async function setAutoHideEnabled(enabled: boolean) {
            await applySetting(autoHideEnabled, enabled, { auto_hide_enabled: enabled });
        }

        async function setClipboardHistoryEnabled(enabled: boolean) {
            const clipboardStore = useClipboardStore();
            await patchAppConfig({ clipboard_history_enabled: enabled });
            clipboardStore.clipboardHistoryEnabled = enabled;
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
            iccShortcut,
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
            autoHideCountdownSeconds,
            autoHideEnabled,
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
            setIccShortcut,
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
            setAutoHideCountdownSeconds,
            setAutoHideEnabled,
            setClipboardHistoryEnabled,
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
            "iccShortcut",
            "followMouseOnShow",
            "followMouseYAnchor",
            "hideOnCtrlRightClick",
            "windowPosition",
            "performanceMode",
            "windowEffectType",
            "strongShortcutMode",
            "autoHideCountdownSeconds",
            "autoHideEnabled",
        ]),
    }
);
