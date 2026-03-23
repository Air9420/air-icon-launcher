import type { enumContextMenuType } from "../stores";
import type { ContextMenuItemInput } from "./contextMenuRegistry";
import type { Permission } from "./permissions";
import type { PluginAPIv1 } from "./api-v1";
import type { PluginCategory, PluginLauncherItem } from "./dto";

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
  permissions?: Permission[];
}

export interface PluginLifecycle {
  onLoad?(api: PluginAPIv1): void | Promise<void>;
  onUnload?(): void | Promise<void>;
  onEnable?(api: PluginAPIv1): void | Promise<void>;
  onDisable?(): void | Promise<void>;
}

export interface Plugin extends PluginLifecycle {
  manifest: PluginManifest;
  activate?: (api: PluginAPIv1) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}

export type PluginStatus = "none" | "loaded" | "enabled" | "error";

export interface PluginInstance {
  manifest: PluginManifest;
  enabled: boolean;
  loaded: boolean;
  status: PluginStatus;
  error?: string;
  plugin?: Plugin;
  sandbox?: HTMLIFrameElement;
  permissions: Permission[];
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

export type { Permission } from "./permissions";
export type { PluginAPIv1 } from "./api-v1";
export type { PluginCategory, PluginLauncherItem } from "./dto";
