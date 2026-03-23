import type { PluginCategory, PluginLauncherItem } from "./dto";
import type { ContextMenuItemInput } from "./contextMenuRegistry";

export interface PluginAppInfo {
  version: string;
  name: string;
  apiVersion: "v1";
}

export interface PluginAPIv1 {
  app: {
    getInfo(): PluginAppInfo;
  };

  launcher: {
    getCategories(): Promise<PluginCategory[]>;
    getItems(categoryId: string): Promise<PluginLauncherItem[]>;
    open(categoryId: string, itemId: string): Promise<void>;
  };

  clipboard: {
    readText(): Promise<string>;
    readImage(): Promise<Blob | null>;
    writeText(text: string): Promise<void>;
    writeImage(blob: Blob): Promise<void>;
  };

  storage: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
    remove(key: string): void;
    clear(): void;
  };

  ui: {
    showToast(
      message: string,
      type?: "info" | "success" | "error"
    ): void;
    registerContextMenuItems(
      menuType: string,
      items: ContextMenuItemInput[]
    ): void;
    unregisterContextMenuItems(menuType?: string): void;
  };

  events: {
    on(
      event: string,
      callback: (...args: unknown[]) => void
    ): () => void;
    off(event: string, callback: (...args: unknown[]) => void): void;
    emit(event: string, ...args: unknown[]): void;
  };

  commands: {
    register(id: string, handler: (...args: unknown[]) => void): void;
    unregister(id: string): void;
    execute(id: string, ...args: unknown[]): void;
  };
}

export const API_VERSION = "v1" as const;
