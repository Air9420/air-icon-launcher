import { invokeOrThrow } from "./invoke-wrapper";

export type FollowMouseAnchor = "top" | "center" | "bottom";
export type CornerHotspotPosition =
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right";
export type CornerHotspotSensitivity = "low" | "medium" | "high";
export type WindowEffectPreference = "blur" | "acrylic";

export type AppConfigSnapshot = {
    version: string;
    theme: string;
    category_cols: number;
    launcher_cols: number;
    toggle_shortcut: string;
    clipboard_shortcut: string;
    follow_mouse_on_show: boolean;
    follow_mouse_y_anchor: FollowMouseAnchor;
    ctrl_drag_enabled: boolean;
    auto_hide_after_launch: boolean;
    show_guide_on_startup: boolean;
    hide_on_ctrl_right_click: boolean;
    corner_hotspot_enabled: boolean;
    corner_hotspot_position: CornerHotspotPosition;
    corner_hotspot_sensitivity: CornerHotspotSensitivity;
    performance_mode: boolean;
    window_effect_type: WindowEffectPreference;
    strong_shortcut_mode: boolean;
    plugin_sandbox_enabled: boolean;
    clipboard_history_enabled: boolean;
    home_section_layouts: unknown;
    clipboard_max_records: number;
    clipboard_max_image_size_mb: number;
    clipboard_encrypted: boolean;
    clipboard_storage_path: string | null;
    backup_on_exit: boolean;
    backup_frequency: string;
    backup_retention: number;
    ai_organizer_base_url: string;
    ai_organizer_model: string;
    ai_organizer_api_key: string;
};

export async function getAppConfig(): Promise<AppConfigSnapshot> {
    return invokeOrThrow<AppConfigSnapshot>("get_config");
}

export async function saveAppConfig(config: AppConfigSnapshot): Promise<void> {
    await invokeOrThrow("save_config", { config });
}

export async function saveAppConfigPatch(
    patch: Partial<AppConfigSnapshot>
): Promise<AppConfigSnapshot> {
    return invokeOrThrow<AppConfigSnapshot>("patch_config", { patch });
}
