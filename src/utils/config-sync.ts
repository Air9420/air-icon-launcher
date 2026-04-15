import { invokeOrThrow } from "./invoke-wrapper";

export type FollowMouseAnchor = "top" | "center" | "bottom";

export type AppConfigSnapshot = {
    version: string;
    theme: string;
    category_cols: number;
    launcher_cols: number;
    toggle_shortcut: string;
    clipboard_shortcut: string;
    follow_mouse_on_show: boolean;
    follow_mouse_y_anchor: FollowMouseAnchor;
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
    const current = await getAppConfig();
    const next = {
        ...current,
        ...patch,
    };
    await saveAppConfig(next);
    return next;
}
