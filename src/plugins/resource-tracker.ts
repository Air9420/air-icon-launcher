const eventBus = new Map<string, Set<(...args: unknown[]) => void>>();

interface PluginResources {
  eventListeners: Array<() => void>;
  tauriListeners: Array<() => void>;
  commands: string[];
  contextMenus: string[];
  timeouts: number[];
  intervals: number[];
}

class PluginResourceTrackerImpl {
  private resources = new Map<string, PluginResources>();

  private getOrCreate(pluginId: string): PluginResources {
    if (!this.resources.has(pluginId)) {
      this.resources.set(pluginId, {
        eventListeners: [],
        tauriListeners: [],
        commands: [],
        contextMenus: [],
        timeouts: [],
        intervals: [],
      });
    }
    return this.resources.get(pluginId)!;
  }

  registerEventListener(
    pluginId: string,
    event: string,
    callback: (...args: unknown[]) => void
  ): () => void {
    const resources = this.getOrCreate(pluginId);

    if (!eventBus.has(event)) {
      eventBus.set(event, new Set());
    }
    eventBus.get(event)!.add(callback);

    const unsubscribe = () => {
      eventBus.get(event)?.delete(callback);
      const index = resources.eventListeners.indexOf(unsubscribe);
      if (index > -1) {
        resources.eventListeners.splice(index, 1);
      }
    };

    resources.eventListeners.push(unsubscribe);
    return unsubscribe;
  }

  registerTauriListener(
    pluginId: string,
    unlisten: () => void
  ): void {
    const resources = this.getOrCreate(pluginId);
    resources.tauriListeners.push(unlisten);
  }

  trackCommand(pluginId: string, commandId: string): void {
    const resources = this.getOrCreate(pluginId);
    if (!resources.commands.includes(commandId)) {
      resources.commands.push(commandId);
    }
  }

  untrackCommand(pluginId: string, commandId: string): void {
    const resources = this.resources.get(pluginId);
    if (resources) {
      const index = resources.commands.indexOf(commandId);
      if (index > -1) {
        resources.commands.splice(index, 1);
      }
    }
  }

  trackContextMenu(pluginId: string, menuType: string): void {
    const resources = this.getOrCreate(pluginId);
    const key = `${pluginId}:${menuType}`;
    if (!resources.contextMenus.includes(key)) {
      resources.contextMenus.push(key);
    }
  }

  untrackContextMenu(pluginId: string, menuType: string): void {
    const resources = this.resources.get(pluginId);
    if (resources) {
      const key = `${pluginId}:${menuType}`;
      const index = resources.contextMenus.indexOf(key);
      if (index > -1) {
        resources.contextMenus.splice(index, 1);
      }
    }
  }

  trackTimeout(pluginId: string, timeoutId: number): void {
    const resources = this.getOrCreate(pluginId);
    resources.timeouts.push(timeoutId);
  }

  trackInterval(pluginId: string, intervalId: number): void {
    const resources = this.getOrCreate(pluginId);
    resources.intervals.push(intervalId);
  }

  cleanup(pluginId: string): void {
    const resources = this.resources.get(pluginId);
    if (!resources) return;

    resources.eventListeners.forEach((unsub) => {
      try {
        unsub();
      } catch (e) {
        console.error(`Error cleaning up event listener for ${pluginId}:`, e);
      }
    });

    resources.tauriListeners.forEach((unsub) => {
      try {
        unsub();
      } catch (e) {
        console.error(`Error cleaning up Tauri listener for ${pluginId}:`, e);
      }
    });

    resources.timeouts.forEach((id) => {
      try {
        clearTimeout(id);
      } catch (e) {
        console.error(`Error clearing timeout for ${pluginId}:`, e);
      }
    });

    resources.intervals.forEach((id) => {
      try {
        clearInterval(id);
      } catch (e) {
        console.error(`Error clearing interval for ${pluginId}:`, e);
      }
    });

    this.resources.delete(pluginId);
  }

  getCommands(pluginId: string): string[] {
    const resources = this.resources.get(pluginId);
    return resources ? [...resources.commands] : [];
  }

  hasResources(pluginId: string): boolean {
    return this.resources.has(pluginId);
  }
}

export const resourceTracker = new PluginResourceTrackerImpl();

export function emitEvent(event: string, ...args: unknown[]): void {
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
