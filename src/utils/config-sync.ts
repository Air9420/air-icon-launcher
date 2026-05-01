import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { HomeSectionLayouts } from "../types/config";
import type { Store } from "pinia";
import { triggerBackup } from "./backup";

export interface AppConfigSnapshot {
  theme: string;
  window_effect_type: string;
  category_cols: number;
  launcher_cols: number;
  toggle_shortcut: string;
  clipboard_shortcut: string;
  display_shortcut: string;
  follow_mouse_on_show: boolean;
  follow_mouse_y_anchor: string;
  ctrl_drag_enabled: boolean;
  auto_hide_after_launch: boolean;
  show_guide_on_startup: boolean;
  hide_on_ctrl_right_click: boolean;
  corner_hotspot_enabled: boolean;
  corner_hotspot_position: string;
  corner_hotspot_sensitivity: string;
  performance_mode: boolean;
  strong_shortcut_mode?: boolean;
  plugin_sandbox_enabled?: boolean;
  home_section_layouts: HomeSectionLayouts;
  auto_hide_countdown_seconds: number;
  auto_hide_enabled: boolean;
  ai_organizer_base_url: string;
  ai_organizer_model: string;
  clipboard_history_enabled?: boolean;
  clipboard_max_records?: number;
  clipboard_max_image_size_mb?: number;
  clipboard_encrypted?: boolean;
  clipboard_storage_path?: string;
  backup_on_exit?: boolean;
  backup_frequency?: string;
  backup_retention?: number;
}

type SettingsStore = Store<"settings", {
  themeClass: string;
  windowEffect: string;
  homeSectionLayouts: HomeSectionLayouts;
  aiOrganizerBaseUrl: string;
  aiOrganizerModel: string;
  loadSettings: () => Promise<void>;
}>;

let unlisten: UnlistenFn | null = null;

export async function initializeConfigSync(store: SettingsStore): Promise<void> {
  await store.loadSettings();

  const emitCurrentConfig = async () => {
    try {
      const snapshot: AppConfigSnapshot = (store as any).toConfigSnapshot()
        ?? {
            theme: store.themeClass,
            window_effect_type: store.windowEffect,
            category_cols: 5,
            launcher_cols: 5,
            toggle_shortcut: "alt+space",
            clipboard_shortcut: "alt+v",
            display_shortcut: "",
            follow_mouse_on_show: false,
            follow_mouse_y_anchor: "center",
            ctrl_drag_enabled: true,
            auto_hide_after_launch: false,
            show_guide_on_startup: true,
            hide_on_ctrl_right_click: false,
            corner_hotspot_enabled: false,
            corner_hotspot_position: "top-right",
            corner_hotspot_sensitivity: "medium",
            performance_mode: false,
            strong_shortcut_mode: true,
            plugin_sandbox_enabled: true,
            home_section_layouts: store.homeSectionLayouts,
            auto_hide_countdown_seconds: 30,
            auto_hide_enabled: true,
            ai_organizer_base_url: store.aiOrganizerBaseUrl,
            ai_organizer_model: store.aiOrganizerModel,
          };
      await invoke("save_config", { config: snapshot });
    } catch (error) {
      console.error("Failed to sync initial config:", error);
    }
  };

  await emitCurrentConfig();

  unlisten = await listen("trigger-config-sync", async () => {
    try {
      const snapshot: AppConfigSnapshot = (store as any).toConfigSnapshot()
        ?? {
            theme: store.themeClass,
            window_effect_type: store.windowEffect,
            category_cols: 5,
            launcher_cols: 5,
            toggle_shortcut: "alt+space",
            clipboard_shortcut: "alt+v",
            display_shortcut: "",
            follow_mouse_on_show: false,
            follow_mouse_y_anchor: "center",
            ctrl_drag_enabled: true,
            auto_hide_after_launch: false,
            show_guide_on_startup: true,
            hide_on_ctrl_right_click: false,
            corner_hotspot_enabled: false,
            corner_hotspot_position: "top-right",
            corner_hotspot_sensitivity: "medium",
            performance_mode: false,
            strong_shortcut_mode: true,
            plugin_sandbox_enabled: true,
            home_section_layouts: store.homeSectionLayouts,
            auto_hide_countdown_seconds: 30,
            auto_hide_enabled: true,
            ai_organizer_base_url: store.aiOrganizerBaseUrl,
            ai_organizer_model: store.aiOrganizerModel,
          };
      await invoke("save_config", { config: snapshot });
      triggerBackup();
    } catch (error) {
      console.error("Failed to sync config:", error);
    }
  });

  const originalSave = (store as any).saveSettings;
  if (originalSave) {
    (store as any).saveSettings = async function (...args: any[]) {
      await originalSave.apply(this, args);
      try {
        await emit("config-updated");
      } catch {}
    };
  }
}
