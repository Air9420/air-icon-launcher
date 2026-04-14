import type { PluginCommand } from "./types";
import { Store } from "../stores";
import { useCategoryStore } from "../stores/categoryStore";
import { invoke } from "../utils/invoke-wrapper";
import type { enumContextMenuType } from "../menus/contextMenuTypes";
import type { ContextMenuItemInput } from "./contextMenuRegistry";
import type { PluginAPIv1 } from "./api-v1";
import { launchStoredItem } from "../utils/launcher-service";
import {
  clearContextMenuItemsByPlugin,
  registerContextMenuItems,
  unregisterContextMenuItems,
} from "./contextMenuRegistry";

type PluginAPI = PluginAPIv1;

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
  const categoryStore = useCategoryStore();

  function getStorage(): Record<string, unknown> {
    if (!pluginStorage.has(pluginId)) {
      pluginStorage.set(pluginId, {});
    }
    return pluginStorage.get(pluginId)!;
  }

  return {
    app: {
      getInfo: () => ({
        version: "1.0.0",
        name: "Air Icon Launcher",
        apiVersion: "v1",
      }),
    },

    launcher: {
      getCategories: async () => {
        return categoryStore.categories.map(cat => ({
          id: cat.id,
          name: cat.name,
          icon: cat.customIconBase64,
        }));
      },
      getItems: async (categoryId: string) => {
        return store.getLauncherItemsByCategoryId(categoryId).map(item => ({
          id: item.id,
          name: item.name,
          path: item.path,
          icon: item.iconBase64,
          categoryId,
        }));
      },
      open: async (categoryId: string, itemId: string) => {
        const item = store.getLauncherItemById(categoryId, itemId);
        if (!item) {
          throw new Error(`Item ${itemId} not found in category ${categoryId}`);
        }
        await launchStoredItem(
          {
            categoryId,
            itemId,
          },
          {
            store,
          }
        );
      },
    },

    clipboard: {
      readText: async () => {
        const result = await invoke<string>("read_clipboard_text");
        if (!result.ok) {
          throw new Error(`Failed to read clipboard: ${result.error.message}`);
        }
        return result.value || "";
      },
      readImage: async () => {
        return null;
      },
      writeText: async (text: string) => {
        const result = await invoke<null>("write_clipboard_text", { text });
        if (!result.ok) {
          throw new Error(`Failed to write clipboard: ${result.error.message}`);
        }
      },
      writeImage: async (_blob: Blob) => {
        throw new Error("Not implemented");
      },
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

    ui: {
      showToast: (message: string, type: ToastType = "info"): void => {
        if (toastCallback) {
          toastCallback(message, type);
        } else {
          console.log(`[Plugin:${pluginId}] Toast (${type}): ${message}`);
        }
      },
      registerContextMenuItems: (
        menuType: enumContextMenuType,
        items: ContextMenuItemInput[]
      ): void => {
        registerContextMenuItems(pluginId, menuType, items);
      },
      unregisterContextMenuItems: (menuType?: enumContextMenuType): void => {
        unregisterContextMenuItems(pluginId, menuType);
      },
    },

    events: {
      on: (event: string, callback: (...args: unknown[]) => void): (() => void) => {
        if (!eventListeners.has(event)) {
          eventListeners.set(event, new Set());
        }
        eventListeners.get(event)!.add(callback);
        return () => {
          eventListeners.get(event)?.delete(callback);
        };
      },
      off: (event: string, callback: (...args: unknown[]) => void): void => {
        eventListeners.get(event)?.delete(callback);
      },
      emit: (event: string, ...args: unknown[]): void => {
        const listeners = eventListeners.get(event);
        if (listeners) {
          listeners.forEach((cb) => {
            try {
              cb(...args);
            } catch (error) {
              console.error(`Error in event listener for ${event}:`, error);
            }
          });
        }
      },
    },

    commands: {
      register: (id: string, handler: (...args: unknown[]) => void): void => {
        const fullCommandId = `${pluginId}:${id}`;
        commands.set(fullCommandId, {
          id: fullCommandId,
          pluginId,
          handler,
        });
      },
      unregister: (id: string): void => {
        const fullCommandId = `${pluginId}:${id}`;
        commands.delete(fullCommandId);
      },
      execute: (id: string, ...args: unknown[]): void => {
        const command = commands.get(id);
        if (command) {
          try {
            command.handler(...args);
          } catch (error) {
            console.error(`Error executing command ${id}:`, error);
          }
        } else {
          console.warn(`Command ${id} not found`);
        }
      },
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

export function executePluginCommand(commandId: string, ...args: unknown[]): void {
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

  clearContextMenuItemsByPlugin(pluginId);
}
