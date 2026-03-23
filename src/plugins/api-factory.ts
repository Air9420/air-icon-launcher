import { invoke } from "../utils/invoke-wrapper";
import { Store, useCategoryStore } from "../stores";
import {
  toPluginCategories,
  toPluginLauncherItems,
  type PluginCategory,
  type PluginLauncherItem,
} from "./dto";
import { PluginAPIv1, API_VERSION } from "./api-v1";
import { Permission, hasPermission, PermissionChecker } from "./permissions";
import { resourceTracker } from "./resource-tracker";
import { ContextMenuItemInput } from "./contextMenuRegistry";
import {
  registerContextMenuItems,
  unregisterContextMenuItems,
  clearContextMenuItemsByPlugin,
} from "./contextMenuRegistry";

type ToastType = "info" | "success" | "error";

let toastCallback: ((message: string, type: ToastType) => void) | null = null;

export function setToastCallback(
  callback: (message: string, type: ToastType) => void
): void {
  toastCallback = callback;
}

const eventBus = new Map<string, Set<(...args: unknown[]) => void>>();
const commandRegistry = new Map<
  string,
  { pluginId: string; handler: (...args: unknown[]) => void }
>();
const pluginStorage = new Map<string, unknown>();

export function createVersionedAPI(
  pluginId: string,
  permissions: Permission[]
): PluginAPIv1 {
  const checker: PermissionChecker = {
    check(permission: Permission): void {
      if (!hasPermission(permissions, permission)) {
        throw new Error(
          `Plugin ${pluginId} lacks permission: ${permission}`
        );
      }
    },
  };

  const store = Store();
  const categoryStore = useCategoryStore();

  return {
    app: {
      getInfo() {
        return {
          version: "1.0.0",
          name: "Air Icon Launcher",
          apiVersion: API_VERSION,
        };
      },
    },

    launcher: {
      async getCategories(): Promise<PluginCategory[]> {
        checker.check("launcher.read");
        return toPluginCategories(categoryStore.categories);
      },

      async getItems(categoryId: string): Promise<PluginLauncherItem[]> {
        checker.check("launcher.read");
        const items = store.getLauncherItemsByCategoryId(categoryId);
        return toPluginLauncherItems(items, categoryId);
      },

      async open(categoryId: string, itemId: string): Promise<void> {
        checker.check("launcher.open");
        const item = store.getLauncherItemById(categoryId, itemId);
        if (!item) {
          throw new Error(
            `Item ${itemId} not found in category ${categoryId}`
          );
        }
        const result = await invoke<null>("launch_item", { path: item.path });
        if (!result.ok) {
          throw new Error(`Failed to launch: ${result.error.message}`);
        }
        store.recordItemUsage(categoryId, itemId);
      },
    },

    clipboard: {
      async readText(): Promise<string> {
        checker.check("clipboard.readText");
        const result = await invoke<string>("get_clipboard_content");
        if (!result.ok) {
          throw new Error(`Failed to read clipboard: ${result.error.message}`);
        }
        return result.value;
      },

      async readImage(): Promise<Blob | null> {
        checker.check("clipboard.readImage");
        return null;
      },

      async writeText(text: string): Promise<void> {
        checker.check("clipboard.writeText");
        const result = await invoke<null>("set_clipboard_content", { content: text });
        if (!result.ok) {
          throw new Error(`Failed to write clipboard: ${result.error.message}`);
        }
      },

      async writeImage(_blob: Blob): Promise<void> {
        checker.check("clipboard.writeImage");
        throw new Error("clipboard.writeImage not implemented");
      },
    },

    storage: {
      get(key: string): unknown {
        const namespacedKey = `${pluginId}:${key}`;
        return pluginStorage.get(namespacedKey);
      },

      set(key: string, value: unknown): void {
        const namespacedKey = `${pluginId}:${key}`;
        pluginStorage.set(namespacedKey, value);
      },

      remove(key: string): void {
        const namespacedKey = `${pluginId}:${key}`;
        pluginStorage.delete(namespacedKey);
      },

      clear(): void {
        const prefix = `${pluginId}:`;
        for (const key of pluginStorage.keys()) {
          if (key.startsWith(prefix)) {
            pluginStorage.delete(key);
          }
        }
      },
    },

    ui: {
      showToast(message: string, type: ToastType = "info"): void {
        if (toastCallback) {
          toastCallback(message, type);
        } else {
          console.log(`[Plugin:${pluginId}] Toast (${type}): ${message}`);
        }
      },

      registerContextMenuItems(
        menuType: string,
        items: ContextMenuItemInput[]
      ): void {
        checker.check("contextMenu");
        resourceTracker.trackContextMenu(pluginId, menuType);
        registerContextMenuItems(pluginId, menuType as any, items);
      },

      unregisterContextMenuItems(menuType?: string): void {
        if (menuType) {
          resourceTracker.untrackContextMenu(pluginId, menuType);
        }
        unregisterContextMenuItems(pluginId, menuType as any);
      },
    },

    events: {
      on(
        event: string,
        callback: (...args: unknown[]) => void
      ): () => void {
        const namespacedEvent = `${pluginId}:${event}`;
        return resourceTracker.registerEventListener(
          pluginId,
          namespacedEvent,
          callback
        );
      },

      off(event: string, callback: (...args: unknown[]) => void): void {
        const namespacedEvent = `${pluginId}:${event}`;
        const listeners = eventBus.get(namespacedEvent);
        if (listeners) {
          listeners.delete(callback);
        }
      },

      emit(event: string, ...args: unknown[]): void {
        const namespacedEvent = `${pluginId}:${event}`;
        const listeners = eventBus.get(namespacedEvent);
        if (listeners) {
          listeners.forEach((callback) => {
            try {
              callback(...args);
            } catch (error) {
              console.error(
                `Error in event listener for ${namespacedEvent}:`,
                error
              );
            }
          });
        }
      },
    },

    commands: {
      register(id: string, handler: (...args: unknown[]) => void): void {
        const fullId = `${pluginId}:${id}`;
        resourceTracker.trackCommand(pluginId, fullId);
        commandRegistry.set(fullId, { pluginId, handler });
      },

      unregister(id: string): void {
        const fullId = `${pluginId}:${id}`;
        resourceTracker.untrackCommand(pluginId, fullId);
        commandRegistry.delete(fullId);
      },

      execute(id: string, ...args: unknown[]): void {
        const fullId = id.includes(":")
          ? id
          : `${pluginId}:${id}`;
        const command = commandRegistry.get(fullId);
        if (command) {
          try {
            command.handler(...args);
          } catch (error) {
            console.error(`Error executing command ${fullId}:`, error);
          }
        } else {
          console.warn(`Command ${fullId} not found`);
        }
      },
    },
  };
}

export function executePluginCommand(
  commandId: string,
  ...args: unknown[]
): void {
  const command = commandRegistry.get(commandId);
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

export function getRegisteredCommands(): Array<{
  id: string;
  pluginId: string;
}> {
  return Array.from(commandRegistry.entries()).map(([id, { pluginId }]) => ({
    id,
    pluginId,
  }));
}

export function clearPluginResources(pluginId: string): void {
  resourceTracker.cleanup(pluginId);
  clearContextMenuItemsByPlugin(pluginId);

  const storagePrefix = `${pluginId}:`;
  for (const key of pluginStorage.keys()) {
    if (key.startsWith(storagePrefix)) {
      pluginStorage.delete(key);
    }
  }
}

export function emitGlobalEvent(
  event: string,
  ...args: unknown[]
): void {
  const listeners = eventBus.get(event);
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
