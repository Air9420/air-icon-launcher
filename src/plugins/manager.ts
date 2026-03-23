import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type {
  PluginManifest,
  PluginInstance,
  Plugin,
} from "./types";
import { createVersionedAPI, clearPluginResources, emitGlobalEvent } from "./api-factory";
import {
  Permission,
  DEFAULT_PERMISSIONS,
  validatePermissions,
} from "./permissions";
import { resourceTracker } from "./resource-tracker";
import { sandboxManager } from "./sandbox";
import { invoke as safeInvoke } from "../utils/invoke-wrapper";

const plugins = ref<Map<string, PluginInstance>>(new Map());

const PLUGIN_STATE_KEY = "plugin-enabled-state";

const SANDBOX_MODE_KEY = "plugin-sandbox-mode";

function loadPluginStates(): Record<string, boolean> {
  try {
    const saved = localStorage.getItem(PLUGIN_STATE_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function savePluginStates(states: Record<string, boolean>): void {
  try {
    localStorage.setItem(PLUGIN_STATE_KEY, JSON.stringify(states));
  } catch (e) {
    console.error("Failed to save plugin states:", e);
  }
}

function getPluginStates(): Record<string, boolean> {
  return loadPluginStates();
}

function isSandboxModeEnabled(): boolean {
  try {
    return localStorage.getItem(SANDBOX_MODE_KEY) === "true";
  } catch {
    return false;
  }
}

function setSandboxModeEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SANDBOX_MODE_KEY, String(enabled));
  } catch (e) {
    console.error("Failed to save sandbox mode:", e);
  }
}

export function usePluginManager() {
  const pluginList = computed(() => Array.from(plugins.value.values()));
  const enabledPlugins = computed(() =>
    pluginList.value.filter((p) => p.status === "enabled")
  );

  async function getPluginDirectory(): Promise<string> {
    return await invoke<string>("get_plugin_directory");
  }

  async function scanPlugins(): Promise<PluginManifest[]> {
    try {
      const manifests = await invoke<PluginManifest[]>("scan_plugins");
      return manifests;
    } catch (error) {
      console.error("Failed to scan plugins:", error);
      return [];
    }
  }

  async function loadPluginManifest(pluginPath: string): Promise<PluginManifest | null> {
    try {
      const manifest = await invoke<PluginManifest>("read_plugin_manifest", {
        pluginPath,
      });
      return manifest;
    } catch (error) {
      console.error(`Failed to load plugin manifest from ${pluginPath}:`, error);
      return null;
    }
  }

  async function loadPluginCode(pluginPath: string, mainFile: string): Promise<string | null> {
    try {
      const code = await invoke<string>("read_plugin_file", {
        pluginPath,
        fileName: mainFile,
      });
      return code;
    } catch (error) {
      console.error(`Failed to load plugin code from ${pluginPath}/${mainFile}:`, error);
      return null;
    }
  }

  function parsePermissions(manifest: PluginManifest): Permission[] {
    const requested = manifest.permissions || [];
    const { valid } = validatePermissions(requested);
    return [...DEFAULT_PERMISSIONS, ...valid];
  }

  function loadPluginDirect(
    code: string,
    manifest: PluginManifest,
    api: ReturnType<typeof createVersionedAPI>
  ): Plugin | null {
    try {
      console.log(`[PluginManager] Creating module factory for ${manifest.id}...`);
      
      let cleanCode = code.trim();
      if (cleanCode.endsWith(";")) {
        cleanCode = cleanCode.slice(0, -1);
      }
      
      const wrappedCode = `return ${cleanCode}(manifest, api);`;
      
      console.log(`[PluginManager] wrappedCode preview:`, wrappedCode.substring(0, 200) + '...');
      
      const moduleFactory = new Function("manifest", "api", wrappedCode);
      console.log(`[PluginManager] Executing module factory...`);
      const pluginExports = moduleFactory(manifest, api);
      
      console.log(`[PluginManager] Raw pluginExports:`, pluginExports);
      console.log(`[PluginManager] Type:`, typeof pluginExports);
      
      const exports = pluginExports || {};
      console.log(`[PluginManager] Plugin exports keys:`, Object.keys(exports));

      const plugin: Plugin = {
        manifest,
        onLoad: exports.onLoad || undefined,
        onUnload: exports.onUnload || undefined,
        onEnable: exports.onEnable || undefined,
        onDisable: exports.onDisable || undefined,
        activate: exports.activate || exports.onEnable || function () {},
        deactivate: exports.deactivate || exports.onDisable || function () {},
      };

      return plugin;
    } catch (error) {
      console.error("[PluginManager] Plugin load error:", error);
      return null;
    }
  }

  async function loadPlugin(pluginId: string): Promise<boolean> {
    const instance = plugins.value.get(pluginId);
    if (!instance) {
      console.error(`[PluginManager] Plugin ${pluginId} not found`);
      return false;
    }

    if (instance.status === "loaded" || instance.status === "enabled") {
      console.log(`[PluginManager] Plugin ${pluginId} already loaded, skipping`);
      return true;
    }

    console.log(`[PluginManager] Loading plugin ${pluginId}...`);

    try {
      const pluginPath = await invoke<string>("get_plugin_path", { pluginId });
      console.log(`[PluginManager] Plugin path: ${pluginPath}`);
      
      const code = await loadPluginCode(pluginPath, instance.manifest.main);

      if (!code) {
        instance.status = "error";
        instance.error = "Failed to load plugin code";
        return false;
      }

      console.log(`[PluginManager] Plugin code loaded, length: ${code.length}`);

      const permissions = parsePermissions(instance.manifest);
      instance.permissions = permissions;

      const useSandbox = isSandboxModeEnabled();
      console.log(`[PluginManager] Sandbox mode: ${useSandbox}`);

      if (useSandbox) {
        try {
          const sandbox = await sandboxManager.createSandbox({
            pluginId,
            manifest: instance.manifest,
            permissions,
            code,
          });
          
          instance.sandbox = sandbox.iframe;
          instance.status = "loaded";
          instance.loaded = true;
          instance.error = undefined;
          
          await sandboxManager.callLifecycle(pluginId, "onLoad");
          
          emitGlobalEvent("plugin:loaded", { pluginId });
          return true;
        } catch (error) {
          console.error(`[PluginManager] Sandbox creation failed:`, error);
          instance.status = "error";
          instance.error = `Sandbox error: ${error}`;
          return false;
        }
      }

      const api = createVersionedAPI(pluginId, permissions);

      const pluginModule = loadPluginDirect(code, instance.manifest, api);

      if (pluginModule) {
        instance.plugin = pluginModule;
        instance.status = "loaded";
        instance.loaded = true;
        instance.error = undefined;

        if (pluginModule.onLoad) {
          try {
            await pluginModule.onLoad(api);
          } catch (e) {
            console.error(`[PluginManager] Plugin ${pluginId} onLoad error:`, e);
          }
        }

        emitGlobalEvent("plugin:loaded", { pluginId });
        return true;
      } else {
        instance.status = "error";
        instance.error = "Failed to initialize plugin";
        return false;
      }
    } catch (error) {
      console.error(`[PluginManager] Error loading plugin ${pluginId}:`, error);
      instance.status = "error";
      instance.error = String(error);
      return false;
    }
  }

  async function unloadPlugin(pluginId: string): Promise<void> {
    const instance = plugins.value.get(pluginId);
    if (!instance) return;

    if (instance.status === "none" || instance.status === "error") {
      return;
    }

    try {
      if (instance.sandbox) {
        if (instance.status === "enabled") {
          await sandboxManager.callLifecycle(pluginId, "onDisable");
        }
        await sandboxManager.callLifecycle(pluginId, "onUnload");
        await sandboxManager.destroySandbox(pluginId);
        instance.sandbox = undefined;
      } else {
        if (instance.status === "enabled" && instance.plugin?.onDisable) {
          await instance.plugin.onDisable();
        }

        if (instance.plugin?.onUnload) {
          await instance.plugin.onUnload();
        }

        resourceTracker.cleanup(pluginId);
        clearPluginResources(pluginId);
      }

      instance.status = "none";
      instance.loaded = false;
      instance.enabled = false;
      instance.plugin = undefined;

      emitGlobalEvent("plugin:unloaded", { pluginId });
    } catch (error) {
      console.error(`[PluginManager] Error unloading plugin ${pluginId}:`, error);
    }
  }

  async function enablePlugin(pluginId: string): Promise<boolean> {
    const instance = plugins.value.get(pluginId);
    if (!instance) return false;

    if (instance.status === "enabled") return true;

    const currentSandboxMode = isSandboxModeEnabled();
    const isRunningInSandbox = !!instance.sandbox;
    
    if (instance.status === "loaded" && isRunningInSandbox !== currentSandboxMode) {
      console.log(`[PluginManager] Sandbox mode changed, reloading plugin ${pluginId}`);
      await unloadPlugin(pluginId);
    }

    if (instance.status !== "loaded") {
      const loaded = await loadPlugin(pluginId);
      if (!loaded) return false;
    }

    try {
      if (instance.sandbox) {
        await sandboxManager.callLifecycle(pluginId, "onEnable");
      } else {
        const api = createVersionedAPI(pluginId, instance.permissions);
        
        if (instance.plugin?.onEnable) {
          await instance.plugin.onEnable(api);
        } else if (instance.plugin?.activate) {
          await instance.plugin.activate(api);
        }
      }

      instance.status = "enabled";
      instance.enabled = true;
      
      const states = getPluginStates();
      states[pluginId] = true;
      savePluginStates(states);
      
      emitGlobalEvent("plugin:enabled", { pluginId });
      return true;
    } catch (error) {
      console.error(`[PluginManager] Failed to enable plugin ${pluginId}:`, error);
      instance.status = "error";
      instance.error = String(error);
      return false;
    }
  }

  async function disablePlugin(pluginId: string): Promise<void> {
    const instance = plugins.value.get(pluginId);
    if (!instance || instance.status !== "enabled") return;

    try {
      if (instance.sandbox) {
        await sandboxManager.callLifecycle(pluginId, "onDisable");
      } else {
        if (instance.plugin?.onDisable) {
          await instance.plugin.onDisable();
        }

        resourceTracker.cleanup(pluginId);
        clearPluginResources(pluginId);
      }

      instance.status = "loaded";
      instance.enabled = false;
      
      const states = getPluginStates();
      states[pluginId] = false;
      savePluginStates(states);
      
      emitGlobalEvent("plugin:disabled", { pluginId });
    } catch (error) {
      console.error(`[PluginManager] Failed to disable plugin ${pluginId}:`, error);
    }
  }

  async function installPluginFromPath(sourcePath: string): Promise<boolean> {
    try {
      const manifest = await loadPluginManifest(sourcePath);
      if (!manifest || plugins.value.has(manifest.id)) return false;

      const installed = await invoke<boolean>("install_plugin", { sourcePath });
      if (installed) {
        const permissions = parsePermissions(manifest);
        plugins.value.set(manifest.id, {
          manifest,
          enabled: false,
          loaded: false,
          status: "none",
          permissions,
        });
        return true;
      }
      return false;
    } catch (error) {
      console.error("Failed to install plugin:", error);
      return false;
    }
  }

  async function uninstallPlugin(pluginId: string): Promise<boolean> {
    const instance = plugins.value.get(pluginId);
    if (!instance) return false;

    try {
      await unloadPlugin(pluginId);
      const result = await safeInvoke<boolean>("uninstall_plugin", { pluginId });
      if (!result.ok) {
        console.error(`Failed to uninstall plugin ${pluginId}: [${result.error.code}] ${result.error.message}`);
        return false;
      }
      plugins.value.delete(pluginId);

      const states = getPluginStates();
      delete states[pluginId];
      savePluginStates(states);

      return true;
    } catch (error) {
      console.error(`Failed to uninstall plugin ${pluginId}:`, error);
      return false;
    }
  }

  async function refreshPlugins(): Promise<void> {
    try {
      const manifests = await scanPlugins();
      const savedStates = getPluginStates();

      for (const manifest of manifests) {
        if (!plugins.value.has(manifest.id)) {
          const permissions = parsePermissions(manifest);
          const wasEnabled = savedStates[manifest.id] === true;
          
          plugins.value.set(manifest.id, {
            manifest,
            enabled: false,
            loaded: false,
            status: "none",
            permissions,
          });
          
          if (wasEnabled) {
            await enablePlugin(manifest.id);
          }
        }
      }

      for (const [pluginId] of plugins.value) {
        if (!manifests.some((m) => m.id === pluginId)) {
          await unloadPlugin(pluginId);
          plugins.value.delete(pluginId);
        }
      }
    } catch (error) {
      console.error("Failed to refresh plugins:", error);
    }
  }

  function getPlugin(pluginId: string): PluginInstance | undefined {
    return plugins.value.get(pluginId);
  }

  function getPluginPermissions(pluginId: string): Permission[] {
    return plugins.value.get(pluginId)?.permissions || [];
  }

  function isSandboxMode(): boolean {
    return isSandboxModeEnabled();
  }

  function setSandboxMode(enabled: boolean): void {
    setSandboxModeEnabled(enabled);
  }

  return {
    plugins,
    pluginList,
    enabledPlugins,
    getPluginDirectory,
    scanPlugins,
    loadPluginManifest,
    loadPlugin,
    unloadPlugin,
    enablePlugin,
    disablePlugin,
    installPluginFromPath,
    uninstallPlugin,
    refreshPlugins,
    getPlugin,
    getPluginPermissions,
    isSandboxMode,
    setSandboxMode,
  };
}

const pluginManagerInstance = usePluginManager();

export function getPluginManager() {
  return pluginManagerInstance;
}
