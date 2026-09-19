/**
 * Shared DTOs for the Rust Plugin Host (P2 commands / P3 Cordis bridge).
 * Mirrors `src-tauri/src/plugin_host/manifest.rs` serialization.
 */

export interface PluginHostCommandContribute {
  id: string;
  title?: string;
}

export interface PluginHostMenuContribute {
  id: string;
  title?: string;
}

export interface PluginHostContributes {
  commands?: PluginHostCommandContribute[];
  menus?: PluginHostMenuContribute[];
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
