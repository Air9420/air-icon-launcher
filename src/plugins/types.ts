import type { Category, LauncherItem } from "../stores";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  main: string;
  icon?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  engines?: {
    "air-icon-launcher": string;
  };
}

export interface PluginAPI {
  getAppInfo: () => { version: string; name: string };
  getCategories: () => Category[];
  getLauncherItems: (categoryId: string) => LauncherItem[];
  launchItem: (categoryId: string, itemId: string) => Promise<void>;
  storage: {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void;
    remove: (key: string) => void;
    clear: () => void;
  };
  showToast: (message: string, type?: "info" | "success" | "error") => void;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
  off: (event: string, callback: (...args: unknown[]) => void) => void;
  emit: (event: string, ...args: unknown[]) => void;
  registerCommand: (commandId: string, handler: (...args: unknown[]) => void) => void;
  unregisterCommand: (commandId: string) => void;
  executeCommand: (commandId: string, ...args: unknown[]) => void;
}

export interface Plugin {
  manifest: PluginManifest;
  activate: (api: PluginAPI) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}

export interface PluginInstance {
  manifest: PluginManifest;
  enabled: boolean;
  loaded: boolean;
  error?: string;
  plugin?: Plugin;
  sandbox?: HTMLIFrameElement;
}

export interface PluginEvent {
  type: string;
  payload?: unknown;
  timestamp: number;
}

export type PluginEventType =
  | "plugin:loaded"
  | "plugin:unloaded"
  | "plugin:enabled"
  | "plugin:disabled"
  | "plugin:error"
  | "app:ready"
  | "app:category:added"
  | "app:category:removed"
  | "app:item:launched";

export interface PluginCommand {
  id: string;
  pluginId: string;
  handler: (...args: unknown[]) => void;
  description?: string;
}

export interface PluginStorage {
  [pluginId: string]: Record<string, unknown>;
}
