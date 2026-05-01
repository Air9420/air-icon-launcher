import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { AppConfig, HomeSectionLayouts } from "../types/config";
import { setBackupEnabled, triggerBackup } from "../utils/backup";
import type { AppConfigSnapshot } from "../utils/config-sync";

const MAX_RECENT = 20;

export const useSettingsStore = defineStore("settings", () => {
  const themeClass = ref<string>("dark");
  const windowEffect = ref<string>("blur");
  const homeSectionLayouts = ref<HomeSectionLayouts>({
    pinned: { preset: "1x5", rows: 1, cols: 5 },
    recent: { preset: "1x5", rows: 1, cols: 5 },
  });
  const categoryColsDraft = ref<number>(5);
  const launcherColsDraft = ref<number>(5);
  const toggleShortcutDraft = ref<string>("alt+space");
  const clipboardShortcutDraft = ref<string>("alt+v");
  const displayShortcutDraft = ref<string>("");
  const followMouseOnShow = ref<boolean>(false);
  const followMouseYAnchor = ref<string>("center");
  const ctrlDragEnabled = ref<boolean>(true);
  const autoHideAfterLaunch = ref<boolean>(false);
  const showGuideOnStartup = ref<boolean>(true);
  const hideOnCtrlRightClick = ref<boolean>(false);
  const cornerHotspotEnabled = ref<boolean>(false);
  const cornerHotspotPosition = ref<string>("top-right");
  const cornerHotspotSensitivity = ref<string>("medium");
  const performanceMode = ref<boolean>(false);
  const guideCompleted = ref<boolean>(false);
  const autoHideCountdownSeconds = ref<number>(30);
  const autoHideEnabled = ref<boolean>(true);
  const strongShortcutMode = ref<boolean>(true);
  const pluginSandboxEnabled = ref<boolean>(true);
  const aiOrganizerBaseUrl = ref<string>("https://api.openai.com/v1");
  const aiOrganizerModel = ref<string>("gpt-5.4-mini");

  const fontFamily = ref<string>("");

  function setPluginSandboxEnabled(val: boolean) {
    pluginSandboxEnabled.value = val;
  }

  function setFontFamily(val: string) {
    fontFamily.value = val;
  }

  function setStrongShortcutMode(val: boolean) {
    strongShortcutMode.value = val;
  }

  function setPerformanceMode(val: boolean) {
    performanceMode.value = val;
  }

  function setHomeSectionLayouts(layouts: HomeSectionLayouts) {
    homeSectionLayouts.value = layouts;
  }

  function setCornerHotspotEnabled(val: boolean) {
    cornerHotspotEnabled.value = val;
  }

  function setCornerHotspotPosition(val: string) {
    cornerHotspotPosition.value = val;
  }

  function setCornerHotspotSensitivity(val: string) {
    cornerHotspotSensitivity.value = val;
  }

  function setCategoryCols(val: number) {
    categoryColsDraft.value = val;
  }

  function setLauncherCols(val: number) {
    launcherColsDraft.value = val;
  }

  function setToggleShortcut(val: string) {
    toggleShortcutDraft.value = val;
  }

  function setClipboardShortcut(val: string) {
    clipboardShortcutDraft.value = val;
  }

  function setDisplayShortcut(val: string) {
    displayShortcutDraft.value = val;
  }

  function setFollowMouseOnShow(val: boolean) {
    followMouseOnShow.value = val;
  }

  function setFollowMouseYAnchor(val: string) {
    followMouseYAnchor.value = val;
  }

  function setCtrlDragEnabled(val: boolean) {
    ctrlDragEnabled.value = val;
  }

  function setAutoHideAfterLaunch(val: boolean) {
    autoHideAfterLaunch.value = val;
  }

  function setShowGuideOnStartup(val: boolean) {
    showGuideOnStartup.value = val;
  }

  function setHideOnCtrlRightClick(val: boolean) {
    hideOnCtrlRightClick.value = val;
  }

  function setGuideCompleted(val: boolean) {
    guideCompleted.value = val;
  }

  function setAutoHideCountdownSeconds(seconds: number) {
    autoHideCountdownSeconds.value = seconds;
  }

  function setAutoHideEnabled(enabled: boolean) {
    autoHideEnabled.value = enabled;
  }

  function hydratePersistedConfig() {
    setGuideCompleted(false);
  }

  function toConfigSnapshot(): AppConfigSnapshot {
    return {
      theme: themeClass.value,
      window_effect_type: windowEffect.value,
      category_cols: categoryColsDraft.value,
      launcher_cols: launcherColsDraft.value,
      toggle_shortcut: toggleShortcutDraft.value,
      clipboard_shortcut: clipboardShortcutDraft.value,
      display_shortcut: displayShortcutDraft.value,
      follow_mouse_on_show: followMouseOnShow.value,
      follow_mouse_y_anchor: followMouseYAnchor.value,
      ctrl_drag_enabled: ctrlDragEnabled.value,
      auto_hide_after_launch: autoHideAfterLaunch.value,
      show_guide_on_startup: showGuideOnStartup.value,
      hide_on_ctrl_right_click: hideOnCtrlRightClick.value,
      corner_hotspot_enabled: cornerHotspotEnabled.value,
      corner_hotspot_position: cornerHotspotPosition.value,
      corner_hotspot_sensitivity: cornerHotspotSensitivity.value,
      performance_mode: performanceMode.value,
      strong_shortcut_mode: strongShortcutMode.value,
      plugin_sandbox_enabled: pluginSandboxEnabled.value,
      home_section_layouts: { ...homeSectionLayouts.value },
      auto_hide_countdown_seconds: autoHideCountdownSeconds.value,
      auto_hide_enabled: autoHideEnabled.value,
      ai_organizer_base_url: aiOrganizerBaseUrl.value,
      ai_organizer_model: aiOrganizerModel.value,
      clipboard_history_enabled: undefined,
      clipboard_max_records: 0,
      clipboard_max_image_size_mb: 0,
      clipboard_encrypted: false,
      clipboard_storage_path: "",
      backup_on_exit: false,
      backup_frequency: "none",
      backup_retention: 0,
    };
  }

  async function saveSettings() {
    try {
      const snapshot = toConfigSnapshot();
      await invoke("save_config", { config: snapshot });
      triggerBackup();
    } catch (error) {
      console.error("Failed to save settings:", error);
      throw error;
    }
  }

  async function loadSettings() {
    try {
      const config = await invoke<AppConfig>("get_config");
      themeClass.value = config.theme || "dark";
      windowEffect.value = (config as any).windowEffectType || config.window_effect_type || "blur";

      categoryColsDraft.value = config.category_cols || 5;
      launcherColsDraft.value = config.launcher_cols || 5;
      toggleShortcutDraft.value = config.toggle_shortcut || "alt+space";
      clipboardShortcutDraft.value = config.clipboard_shortcut || "alt+v";
      displayShortcutDraft.value = (config as any).displayShortcut || config.display_shortcut || "";
      followMouseOnShow.value = config.follow_mouse_on_show ?? false;
      followMouseYAnchor.value = config.follow_mouse_y_anchor || "center";
      ctrlDragEnabled.value = config.ctrl_drag_enabled ?? true;
      autoHideAfterLaunch.value = config.auto_hide_after_launch ?? false;
      showGuideOnStartup.value = config.show_guide_on_startup ?? true;
      hideOnCtrlRightClick.value = config.hide_on_ctrl_right_click ?? false;
      cornerHotspotEnabled.value = (config as any).cornerHotspotEnabled || config.corner_hotspot_enabled || false;
      cornerHotspotPosition.value = (config as any).cornerHotspotPosition || config.corner_hotspot_position || "top-right";
      cornerHotspotSensitivity.value = (config as any).cornerHotspotSensitivity || config.corner_hotspot_sensitivity || "medium";
      performanceMode.value = (config as any).performanceMode || config.performance_mode || false;
      strongShortcutMode.value = (config as any).strongShortcutMode ?? config.strong_shortcut_mode ?? true;
      pluginSandboxEnabled.value = (config as any).pluginSandboxEnabled ?? config.plugin_sandbox_enabled ?? true;
      autoHideCountdownSeconds.value = (config as any).autoHideCountdownSeconds ?? config.auto_hide_countdown_seconds ?? 30;
      autoHideEnabled.value = (config as any).autoHideEnabled ?? config.auto_hide_enabled ?? true;

      if (config.home_section_layouts) {
        homeSectionLayouts.value = config.home_section_layouts;
      }

      setBackupEnabled((config as any).backupOnExit || config.backup_on_exit || false);

      hydratePersistedConfig();
    } catch (error) {
      console.error("Failed to load settings:", error);
    }
  }

  return {
    themeClass,
    windowEffect,
    homeSectionLayouts,
    categoryColsDraft,
    launcherColsDraft,
    toggleShortcutDraft,
    clipboardShortcutDraft,
    displayShortcutDraft,
    followMouseOnShow,
    followMouseYAnchor,
    ctrlDragEnabled,
    autoHideAfterLaunch,
    showGuideOnStartup,
    hideOnCtrlRightClick,
    guideCompleted,
    cornerHotspotEnabled,
    cornerHotspotPosition,
    cornerHotspotSensitivity,
    performanceMode,
    autoHideCountdownSeconds,
    autoHideEnabled,
    strongShortcutMode,
    pluginSandboxEnabled,
    aiOrganizerBaseUrl,
    aiOrganizerModel,
    fontFamily,
    setFontFamily,
    setHomeSectionLayouts,
    setCategoryCols,
    setLauncherCols,
    setToggleShortcut,
    setClipboardShortcut,
    setDisplayShortcut,
    setFollowMouseOnShow,
    setFollowMouseYAnchor,
    setCtrlDragEnabled,
    setAutoHideAfterLaunch,
    setShowGuideOnStartup,
    setHideOnCtrlRightClick,
    setGuideCompleted,
    setCornerHotspotEnabled,
    setCornerHotspotPosition,
    setCornerHotspotSensitivity,
    setPerformanceMode,
    setAutoHideCountdownSeconds,
    setAutoHideEnabled,
    setStrongShortcutMode,
    setPluginSandboxEnabled,
    hydratePersistedConfig,
    loadSettings,
    saveSettings,
    toConfigSnapshot,
  };
}, {
  persistedState: {
    persist: true,
    key: "launcher-settings",
    storage: localStorage,
    paths: [
      "themeClass",
      "windowEffect",
      "homeSectionLayouts",
      "categoryColsDraft",
      "launcherColsDraft",
      "toggleShortcutDraft",
      "clipboardShortcutDraft",
      "displayShortcutDraft",
      "followMouseOnShow",
      "followMouseYAnchor",
      "ctrlDragEnabled",
      "autoHideAfterLaunch",
      "showGuideOnStartup",
      "hideOnCtrlRightClick",
      "cornerHotspotEnabled",
      "cornerHotspotPosition",
      "cornerHotspotSensitivity",
      "performanceMode",
      "autoHideCountdownSeconds",
      "autoHideEnabled",
      "strongShortcutMode",
      "pluginSandboxEnabled",
      "aiOrganizerBaseUrl",
      "aiOrganizerModel",
      "fontFamily",
    ],
    beforeHydrate: (store: any) => {
      if (store.guideCompleted !== undefined) {
        const completed = store.guideCompleted;
        store.guideCompleted = undefined;
        store.__hydratedGuideCompleted = completed;
      }
    },
    afterHydrate: (store: any) => {
      if (store.__hydratedGuideCompleted !== undefined) {
        store.guideCompleted = store.__hydratedGuideCompleted;
        delete store.__hydratedGuideCompleted;
      } else {
        store.guideCompleted = false;
      }
    },
  },
});
