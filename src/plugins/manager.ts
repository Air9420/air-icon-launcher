import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { PluginManifest, PluginInstance, Plugin } from "./types";
import { createPluginAPI, clearPluginData, emitPluginEvent } from "./api";

const plugins = ref<Map<string, PluginInstance>>(new Map());

export function usePluginManager() {
  const pluginList = computed(() => Array.from(plugins.value.values()));
  const enabledPlugins = computed(() =>
    pluginList.value.filter((p) => p.enabled && p.loaded)
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

  async function loadPlugin(pluginId: string): Promise<boolean> {
    const instance = plugins.value.get(pluginId);
    if (!instance) {
      console.error(`Plugin ${pluginId} not found`);
      return false;
    }

    if (instance.loaded) {
      return true;
    }

    try {
      const pluginPath = await invoke<string>("get_plugin_path", { pluginId });
      const code = await loadPluginCode(pluginPath, instance.manifest.main);

      if (!code) {
        instance.error = "Failed to load plugin code";
        return false;
      }

      const api = createPluginAPI(pluginId);

      const pluginModule = await loadPluginInSandbox(code, instance.manifest, api);

      if (pluginModule) {
        instance.plugin = pluginModule;
        instance.loaded = true;
        instance.error = undefined;
        emitPluginEvent("plugin:loaded", { pluginId });
        return true;
      } else {
        instance.error = "Failed to initialize plugin";
        return false;
      }
    } catch (error) {
      console.error(`Error loading plugin ${pluginId}:`, error);
      instance.error = String(error);
      return false;
    }
  }

  async function loadPluginInSandbox(
    code: string,
    manifest: PluginManifest,
    api: ReturnType<typeof createPluginAPI>
  ): Promise<Plugin | null> {
    return new Promise((resolve) => {
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.sandbox.add("allow-scripts");

      const pluginId = manifest.id;

      iframe.onload = () => {
        const iframeWindow = iframe.contentWindow;
        if (!iframeWindow) {
          resolve(null);
          return;
        }

        const script = iframeWindow.document.createElement("script");
        script.textContent = `
          (function() {
            const manifest = ${JSON.stringify(manifest)};
            const api = {
              getAppInfo: ${api.getAppInfo.toString()},
              getCategories: ${api.getCategories.toString()},
              getLauncherItems: ${api.getLauncherItems.toString()},
              launchItem: ${api.launchItem.toString()},
              storage: {
                get: ${api.storage.get.toString()},
                set: ${api.storage.set.toString()},
                remove: ${api.storage.remove.toString()},
                clear: ${api.storage.clear.toString()}
              },
              showToast: ${api.showToast.toString()},
              on: ${api.on.toString()},
              off: ${api.off.toString()},
              emit: ${api.emit.toString()},
              registerCommand: ${api.registerCommand.toString()},
              unregisterCommand: ${api.unregisterCommand.toString()},
              executeCommand: ${api.executeCommand.toString()}
            };

            let pluginExports = {};

            try {
              const moduleFactory = new Function('manifest', 'api', \`${code}\`);
              pluginExports = moduleFactory(manifest, api) || {};

              const plugin = {
                manifest: manifest,
                activate: pluginExports.activate || function() {},
                deactivate: pluginExports.deactivate || function() {}
              };

              window.__pluginResult = plugin;
            } catch (e) {
              window.__pluginError = e.message;
            }
          })();
        `;

        iframeWindow.document.head.appendChild(script);

        setTimeout(() => {
          const result = (iframeWindow as unknown as { __pluginResult?: Plugin; __pluginError?: string }).__pluginResult;
          const error = (iframeWindow as unknown as { __pluginError?: string }).__pluginError;

          if (error) {
            console.error("Plugin sandbox error:", error);
            resolve(null);
          } else if (result) {
            try {
              const activateResult = result.activate(api);
              if (activateResult instanceof Promise) {
                activateResult.then(() => {
                  const instance = plugins.value.get(pluginId);
                  if (instance) {
                    instance.sandbox = iframe;
                  }
                  resolve(result);
                }).catch((err: unknown) => {
                  console.error("Plugin activation error:", err);
                  resolve(null);
                });
              } else {
                const instance = plugins.value.get(pluginId);
                if (instance) {
                  instance.sandbox = iframe;
                }
                resolve(result);
              }
            } catch (err: unknown) {
              console.error("Plugin activation error:", err);
              resolve(null);
            }
          } else {
            resolve(null);
          }
        }, 100);
      };

      document.body.appendChild(iframe);
    });
  }

  async function unloadPlugin(pluginId: string): Promise<void> {
    const instance = plugins.value.get(pluginId);
    if (!instance || !instance.loaded) {
      return;
    }

    try {
      if (instance.plugin?.deactivate) {
        await instance.plugin.deactivate();
      }

      if (instance.sandbox) {
        instance.sandbox.remove();
      }

      clearPluginData(pluginId);
      instance.loaded = false;
      instance.plugin = undefined;
      instance.sandbox = undefined;
      emitPluginEvent("plugin:unloaded", { pluginId });
    } catch (error) {
      console.error(`Error unloading plugin ${pluginId}:`, error);
    }
  }

  async function enablePlugin(pluginId: string): Promise<boolean> {
    const instance = plugins.value.get(pluginId);
    if (!instance) {
      return false;
    }

    if (!instance.loaded) {
      const loaded = await loadPlugin(pluginId);
      if (!loaded) {
        return false;
      }
    }

    instance.enabled = true;
    emitPluginEvent("plugin:enabled", { pluginId });
    return true;
  }

  async function disablePlugin(pluginId: string): Promise<void> {
    const instance = plugins.value.get(pluginId);
    if (!instance) {
      return;
    }

    await unloadPlugin(pluginId);
    instance.enabled = false;
    emitPluginEvent("plugin:disabled", { pluginId });
  }

  async function installPluginFromPath(sourcePath: string): Promise<boolean> {
    try {
      const manifest = await loadPluginManifest(sourcePath);
      if (!manifest) {
        console.error("Invalid plugin: missing manifest");
        return false;
      }

      if (plugins.value.has(manifest.id)) {
        console.error(`Plugin ${manifest.id} already installed`);
        return false;
      }

      const installed = await invoke<boolean>("install_plugin", { sourcePath });
      if (installed) {
        const instance: PluginInstance = {
          manifest,
          enabled: false,
          loaded: false,
        };
        plugins.value.set(manifest.id, instance);
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
    if (!instance) {
      return false;
    }

    try {
      await unloadPlugin(pluginId);
      await invoke("uninstall_plugin", { pluginId });
      plugins.value.delete(pluginId);
      return true;
    } catch (error) {
      console.error(`Failed to uninstall plugin ${pluginId}:`, error);
      return false;
    }
  }

  async function refreshPlugins(): Promise<void> {
    try {
      const manifests = await scanPlugins();

      for (const manifest of manifests) {
        if (!plugins.value.has(manifest.id)) {
          const instance: PluginInstance = {
            manifest,
            enabled: false,
            loaded: false,
          };
          plugins.value.set(manifest.id, instance);
        }
      }

      for (const [pluginId] of plugins.value) {
        const exists = manifests.some((m) => m.id === pluginId);
        if (!exists) {
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
  };
}

const pluginManagerInstance = usePluginManager();

export function getPluginManager() {
  return pluginManagerInstance;
}
