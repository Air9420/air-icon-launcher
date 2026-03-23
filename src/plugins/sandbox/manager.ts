import { invoke } from "../../utils/invoke-wrapper";
import { resourceTracker } from "../resource-tracker";
import {
  registerContextMenuItems,
  unregisterContextMenuItems,
  clearContextMenuItemsByPlugin,
} from "../contextMenuRegistry";
import { Store, useCategoryStore } from "../../stores";
import { toPluginCategories, toPluginLauncherItems } from "../dto";
import type { SandboxMessage, SandboxConfig, SandboxStatus, SandboxInstance } from "./types";
import { SANDBOX_HTML } from "./types";

type ToastType = "info" | "success" | "error";

let toastCallback: ((message: string, type: ToastType) => void) | null = null;

export function setSandboxToastCallback(
  callback: (message: string, type: ToastType) => void
): void {
  toastCallback = callback;
}

class SandboxManagerImpl {
  private sandboxes = new Map<string, SandboxInstance>();
  private messageId = 0;
  private eventListeners = new Map<string, Set<(...args: unknown[]) => void>>();
  private commandHandlers = new Map<string, (pluginId: string, ...args: unknown[]) => unknown>();
  private pluginStorage = new Map<string, Map<string, unknown>>();

  constructor() {
    window.addEventListener("message", this.handleMessage.bind(this));
    
    this.commandHandlers.set("launcher.getCategories", async () => {
      const categoryStore = useCategoryStore();
      return toPluginCategories(categoryStore.categories);
    });
    
    this.commandHandlers.set("launcher.getItems", async (_pluginId, categoryId) => {
      const store = Store();
      const items = store.getLauncherItemsByCategoryId(categoryId as string);
      return toPluginLauncherItems(items, categoryId as string);
    });
    
    this.commandHandlers.set("launcher.open", async (_pluginId, categoryId, itemId) => {
      const store = Store();
      const item = store.getLauncherItemById(categoryId as string, itemId as string);
      if (!item) {
        throw new Error(`Item ${itemId} not found in category ${categoryId}`);
      }
      const result = await invoke<null>("launch_item", { path: item.path });
      if (!result.ok) {
        throw new Error(`Failed to launch: ${result.error.message}`);
      }
      store.recordItemUsage(categoryId as string, itemId as string);
    });
    
    this.commandHandlers.set("clipboard.readText", async () => {
      const result = await invoke<string>("get_clipboard_content");
      if (!result.ok) {
        throw new Error(`Failed to read clipboard: ${result.error.message}`);
      }
      return result.value;
    });
    
    this.commandHandlers.set("clipboard.writeText", async (_pluginId, text) => {
      const result = await invoke<null>("set_clipboard_content", { content: text });
      if (!result.ok) {
        throw new Error(`Failed to write clipboard: ${result.error.message}`);
      }
    });
    
    this.commandHandlers.set("ui.showToast", (_pluginId, message, type) => {
      if (toastCallback) {
        toastCallback(message as string, (type as ToastType) || "info");
      }
    });
    
    this.commandHandlers.set("ui.registerContextMenuItems", (pluginId, menuType, items) => {
      resourceTracker.trackContextMenu(pluginId, menuType as string);
      const sandbox = this.sandboxes.get(pluginId);
      const convertedItems = (items as any[]).map((item: any) => {
        if (item.commandId) {
          return {
            type: item.type || "item",
            id: item.id,
            label: item.label,
            icon: item.icon,
            order: item.order,
            onClick: () => {
              if (sandbox) {
                this.sendToSandbox(sandbox, {
                  type: "request",
                  method: "ui.executeContextMenuHandler",
                  params: [item.commandId],
                });
              }
            },
          };
        }
        return item;
      });
      registerContextMenuItems(pluginId, menuType as any, convertedItems);
    });
    
    this.commandHandlers.set("ui.unregisterContextMenuItems", (pluginId, menuType) => {
      if (menuType) {
        resourceTracker.untrackContextMenu(pluginId, menuType as string);
      }
      unregisterContextMenuItems(pluginId, menuType as any);
    });
    
    this.commandHandlers.set("events.on", (pluginId, event) => {
      const namespacedEvent = `${pluginId}:${event}`;
      if (!this.eventListeners.has(namespacedEvent)) {
        this.eventListeners.set(namespacedEvent, new Set());
      }
    });
    
    this.commandHandlers.set("events.off", (pluginId, event) => {
      const namespacedEvent = `${pluginId}:${event}`;
      this.eventListeners.delete(namespacedEvent);
    });
    
    this.commandHandlers.set("events.emit", (pluginId, event, ...args) => {
      const namespacedEvent = `${pluginId}:${event}`;
      const listeners = this.eventListeners.get(namespacedEvent);
      if (listeners) {
        listeners.forEach((callback) => {
          try {
            callback(...args);
          } catch (error) {
            console.error(`Error in event listener for ${namespacedEvent}:`, error);
          }
        });
      }
    });
    
    this.commandHandlers.set("commands.register", (pluginId, id) => {
      const fullId = `${pluginId}:${id}`;
      resourceTracker.trackCommand(pluginId, fullId);
    });
    
    this.commandHandlers.set("commands.unregister", (pluginId, id) => {
      const fullId = `${pluginId}:${id}`;
      resourceTracker.untrackCommand(pluginId, fullId);
    });
    
    this.commandHandlers.set("commands.execute", (pluginId, id, ...args) => {
      const idStr = String(id);
      const fullId = idStr.includes(":") ? idStr : `${pluginId}:${idStr}`;
      const sandbox = this.sandboxes.get(pluginId);
      if (sandbox) {
        this.sendToSandbox(sandbox, {
          type: "request",
          method: "commands.execute",
          params: [fullId, ...args],
        });
      }
    });
  }

  private handleMessage(event: MessageEvent): void {
    const msg = event.data as SandboxMessage;
    
    if (!msg || !msg.type) return;
    
    if (msg.type === "loaded") {
      return;
    }
    
    if (msg.type === "ready") {
      return;
    }
    
    if (msg.type === "error") {
      console.error("[Sandbox] error:", msg.error);
      return;
    }
    
    if (msg.type === "request" && msg.method && msg.id) {
      this.handleRequest(msg, event.source);
    }
  }

  private async handleRequest(msg: SandboxMessage, source: MessageEventSource | null): Promise<void> {
    let pluginId: string | null = null;
    let sandbox: SandboxInstance | null = null;
    
    for (const [id, instance] of this.sandboxes) {
      if (instance.iframe.contentWindow === source) {
        pluginId = id;
        sandbox = instance;
        break;
      }
    }
    
    if (!pluginId || !sandbox) {
      return;
    }
    
    const handler = this.commandHandlers.get(msg.method || "");
    
    if (!handler) {
      this.sendToSandbox(sandbox, {
        id: msg.id,
        type: "response",
        error: `Unknown method: ${msg.method}`,
      });
      return;
    }
    
    try {
      const result = await handler(pluginId, ...(msg.params as unknown[] || []));
      this.sendToSandbox(sandbox, {
        id: msg.id,
        type: "response",
        result,
      });
    } catch (error) {
      this.sendToSandbox(sandbox, {
        id: msg.id,
        type: "response",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private sendToSandbox(sandbox: SandboxInstance, msg: Partial<SandboxMessage>): void {
    if (sandbox.iframe.contentWindow) {
      const serializableMsg = JSON.parse(JSON.stringify({
        id: msg.id || `msg_${++this.messageId}`,
        ...msg,
      }));
      sandbox.iframe.contentWindow.postMessage(serializableMsg, "*");
    }
  }

  async createSandbox(config: SandboxConfig): Promise<SandboxInstance> {
    const { pluginId, manifest, permissions, code } = config;
    
    if (this.sandboxes.has(pluginId)) {
      await this.destroySandbox(pluginId);
    }
    
    const iframe = document.createElement("iframe");
    iframe.id = `sandbox-${pluginId}`;
    iframe.sandbox.add("allow-scripts");
    iframe.style.display = "none";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    iframe.style.position = "absolute";
    iframe.style.top = "-9999px";
    iframe.style.left = "-9999px";
    
    const sandbox: SandboxInstance = {
      id: pluginId,
      iframe,
      status: "loading",
      permissions,
      pendingRequests: new Map(),
    };
    
    this.sandboxes.set(pluginId, sandbox);

    document.body.appendChild(iframe);
    
    const scriptContent = SANDBOX_HTML.match(/<script>([\s\S]*?)<\/script>/)?.[1] || '';
    const sandboxHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'unsafe-inline' 'unsafe-eval'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; img-src 'none'; style-src 'unsafe-inline';"></head><body><script>${scriptContent}<\/script></body></html>`;
    
    iframe.srcdoc = sandboxHtml;
    
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Sandbox load timeout"));
      }, 10000);
      
      const handler = (event: MessageEvent) => {
        if (event.source !== iframe.contentWindow) return;
        const msg = event.data;
        if (msg && msg.type === "loaded") {
          clearTimeout(timeout);
          window.removeEventListener("message", handler);
          resolve();
        }
      };
      
      window.addEventListener("message", handler);
    });
    
    sandbox.status = "loading";
    
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Plugin init timeout"));
      }, 10000);
      
      const handler = (event: MessageEvent) => {
        if (event.source !== iframe.contentWindow) return;
        const msg = event.data;
        if (msg && msg.type === "ready") {
          clearTimeout(timeout);
          window.removeEventListener("message", handler);
          resolve();
        }
      };
      
      window.addEventListener("message", handler);
      
      this.sendToSandbox(sandbox, {
        command: "init",
        code,
        manifest,
        permissions,
      });
    });
    
    sandbox.status = "ready";
    return sandbox;
  }

  async callLifecycle(pluginId: string, method: "onLoad" | "onUnload" | "onEnable" | "onDisable"): Promise<void> {
    const sandbox = this.sandboxes.get(pluginId);
    if (!sandbox || sandbox.status !== "ready") {
      throw new Error(`Sandbox ${pluginId} not ready`);
    }
    
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`${method} timeout`));
      }, 30000);
      
      const msgId = `lifecycle_${method}_${++this.messageId}`;
      
      const handler = (event: MessageEvent) => {
        const msg = event.data;
        if (msg && msg.id === msgId && msg.type === "response") {
          clearTimeout(timeout);
          window.removeEventListener("message", handler);
          if (msg.error) {
            reject(new Error(msg.error));
          } else {
            resolve();
          }
        }
      };
      
      window.addEventListener("message", handler);
      
      this.sendToSandbox(sandbox, {
        id: msgId,
        command: method,
      });
    });
  }

  async destroySandbox(pluginId: string): Promise<void> {
    const sandbox = this.sandboxes.get(pluginId);
    if (!sandbox) return;
    
    try {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => resolve(), 5000);
        
        const msgId = `destroy_${++this.messageId}`;
        
        const handler = (event: MessageEvent) => {
          const msg = event.data;
          if (msg && msg.id === msgId && msg.type === "response") {
            clearTimeout(timeout);
            window.removeEventListener("message", handler);
            resolve();
          }
        };
        
        window.addEventListener("message", handler);
        
        this.sendToSandbox(sandbox, {
          id: msgId,
          command: "destroy",
        });
      });
    } catch (error) {
      console.error(`Error destroying sandbox ${pluginId}:`, error);
    }
    
    if (sandbox.iframe.parentNode) {
      sandbox.iframe.parentNode.removeChild(sandbox.iframe);
    }
    
    sandbox.status = "destroyed";
    this.sandboxes.delete(pluginId);
    
    resourceTracker.cleanup(pluginId);
    clearContextMenuItemsByPlugin(pluginId);
    
    const storagePrefix = `${pluginId}:`;
    for (const key of this.pluginStorage.keys()) {
      if (key.startsWith(storagePrefix)) {
        this.pluginStorage.delete(key);
      }
    }
    
    for (const [key] of this.eventListeners) {
      if (key.startsWith(storagePrefix)) {
        this.eventListeners.delete(key);
      }
    }
  }

  getSandbox(pluginId: string): SandboxInstance | undefined {
    return this.sandboxes.get(pluginId);
  }

  getStatus(pluginId: string): SandboxStatus | undefined {
    return this.sandboxes.get(pluginId)?.status;
  }

  emitEvent(pluginId: string, event: string, ...args: unknown[]): void {
    const sandbox = this.sandboxes.get(pluginId);
    if (!sandbox || sandbox.status !== "ready") return;
    
    this.sendToSandbox(sandbox, {
      type: "event",
      eventType: event,
      eventData: { args },
    });
  }

  emitGlobalEvent(event: string, ...args: unknown[]): void {
    for (const [pluginId] of this.sandboxes) {
      this.emitEvent(pluginId, event, ...args);
    }
  }
}

export const sandboxManager = new SandboxManagerImpl();
