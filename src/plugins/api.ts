import type { PluginAPI, PluginCommand } from "./types";
import type { Category, LauncherItem } from "../stores";
import { Store } from "../stores";
import { invoke } from "@tauri-apps/api/core";

type ToastType = "info" | "success" | "error";

const eventListeners = new Map<string, Set<(...args: unknown[]) => void>>();
const commands = new Map<string, PluginCommand>();
const pluginStorage = new Map<string, Record<string, unknown>>();

let toastCallback: ((message: string, type: ToastType) => void) | null = null;

export function setToastCallback(callback: (message: string, type: ToastType) => void) {
  toastCallback = callback;
}

export function createPluginAPI(pluginId: string): PluginAPI {
  const store = Store();

  function getStorage(): Record<string, unknown> {
    if (!pluginStorage.has(pluginId)) {
      pluginStorage.set(pluginId, {});
    }
    return pluginStorage.get(pluginId)!;
  }

  return {
    getAppInfo: () => ({
      version: "1.0.0",
      name: "Air Icon Launcher",
    }),

    getCategories: (): Category[] => {
      return store.categories;
    },

    getLauncherItems: (categoryId: string): LauncherItem[] => {
      return store.getLauncherItemsByCategoryId(categoryId);
    },

    launchItem: async (categoryId: string, itemId: string): Promise<void> => {
      const item = store.getLauncherItemById(categoryId, itemId);
      if (!item) {
        throw new Error(`Item ${itemId} not found in category ${categoryId}`);
      }
      await invoke("launch_item", { path: item.path });
      store.recordItemUsage(categoryId, itemId);
    },

    storage: {
      get: (key: string): unknown => {
        return getStorage()[key];
      },
      set: (key: string, value: unknown): void => {
        getStorage()[key] = value;
      },
      remove: (key: string): void => {
        delete getStorage()[key];
      },
      clear: (): void => {
        pluginStorage.set(pluginId, {});
      },
    },

    showToast: (message: string, type: ToastType = "info"): void => {
      if (toastCallback) {
        toastCallback(message, type);
      } else {
        console.log(`[Plugin:${pluginId}] Toast (${type}): ${message}`);
      }
    },

    on: (event: string, callback: (...args: unknown[]) => void): void => {
      if (!eventListeners.has(event)) {
        eventListeners.set(event, new Set());
      }
      eventListeners.get(event)!.add(callback);
    },

    off: (event: string, callback: (...args: unknown[]) => void): void => {
      eventListeners.get(event)?.delete(callback);
    },

    emit: (event: string, ...args: unknown[]): void => {
      const listeners = eventListeners.get(event);
      if (listeners) {
        listeners.forEach((callback) => {
          try {
            callback(...args);
          } catch (error) {
            console.error(`Error in event listener for ${event}:`, error);
          }
        });
      }
    },

    registerCommand: (commandId: string, handler: (...args: unknown[]) => void): void => {
      const fullCommandId = `${pluginId}:${commandId}`;
      commands.set(fullCommandId, {
        id: fullCommandId,
        pluginId,
        handler,
      });
    },

    unregisterCommand: (commandId: string): void => {
      const fullCommandId = `${pluginId}:${commandId}`;
      commands.delete(fullCommandId);
    },

    executeCommand: (commandId: string, ...args: unknown[]): void => {
      const command = commands.get(commandId);
      if (command) {
        try {
          command.handler(...args);
        } catch (error) {
          console.error(`Error executing command ${commandId}:`, error);
        }
      } else {
        console.warn(`Command ${commandId} not found`);
      }
    },
  };
}

export function emitPluginEvent(event: string, ...args: unknown[]): void {
  const listeners = eventListeners.get(event);
  if (listeners) {
    listeners.forEach((callback) => {
      try {
        callback(...args);
      } catch (error) {
        console.error(`Error in event listener for ${event}:`, error);
      }
    });
  }
}

export function getRegisteredCommands(): PluginCommand[] {
  return Array.from(commands.values());
}

export function clearPluginData(pluginId: string): void {
  pluginStorage.delete(pluginId);
  eventListeners.forEach((listeners) => {
    listeners.clear();
  });
  for (const [commandId, command] of commands) {
    if (command.pluginId === pluginId) {
      commands.delete(commandId);
    }
  }
}
