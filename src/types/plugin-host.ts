/**
 * Shared DTOs for the Rust Plugin Host (P2 commands / P3 Cordis bridge).
 * Mirrors `src-tauri/src/plugin_host/manifest.rs` serialization.
 */

export interface PluginHostCommandContribute {
  id: string;
  title?: string;
  /** 实际 invoke 的 method；缺省时用 id。 */
  method?: string;
}

export interface PluginHostMenuContribute {
  id: string;
  title?: string;
}

/** 设置项候选项（select / multiselect 用）。 */
export interface PluginHostSettingOption {
  value: unknown;
  label?: string;
}

/** 设置项声明；前端据此渲染表单。 */
export interface PluginHostSettingField {
  key: string;
  title?: string;
  description?: string;
  /** `text` | `number` | `bool` | `select` | `multiselect` | `hotkey` */
  type?: string;
  default?: unknown;
  options?: PluginHostSettingOption[];
}

export interface PluginHostContributes {
  commands?: PluginHostCommandContribute[];
  menus?: PluginHostMenuContribute[];
  settings?: PluginHostSettingField[];
}

/** `plugin_host_scan` / `plugin_host_install` result. */
export interface PluginHostManifest {
  manifest_version: number;
  id: string;
  name: string;
  version: string;
  runtime: string;
  entry: string;
  description: string;
  author: string;
  capabilities: string[];
  contributes: PluginHostContributes;
}

/** `plugin_host_list` row. */
export interface PluginHostRuntimeInfo {
  id: string;
  name: string;
  version: string;
  runtime: string;
  description: string;
  author: string;
  entry: string;
  path: string;
  enabled: boolean;
  loaded: boolean;
  capabilities: string[];
  contributes: PluginHostContributes;
  last_error?: string | null;
  log_count: number;
}

/** Tauri events `plugin_host_event` / `plugin_host_bus` payload. */
export interface PluginHostEventPayload {
  plugin_id: string;
  event: string;
  payload: unknown;
}
