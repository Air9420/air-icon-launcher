import type { Permission } from "../permissions";

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

export interface SandboxMessage {
  id: string;
  type: "request" | "response" | "event" | "error" | "loaded" | "ready";
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: string;
  eventType?: string;
  eventData?: unknown;
  command?: string;
  code?: string;
  manifest?: PluginManifest;
  permissions?: Permission[];
}

export interface SandboxConfig {
  pluginId: string;
  manifest: PluginManifest;
  permissions: Permission[];
  code: string;
}

export interface SandboxAPIRequest {
  method: string;
  params: unknown[];
}

export interface SandboxAPIResponse {
  success: boolean;
  result?: unknown;
  error?: string;
}

export type SandboxStatus = "idle" | "loading" | "ready" | "error" | "destroyed";

export interface SandboxInstance {
  id: string;
  iframe: HTMLIFrameElement;
  status: SandboxStatus;
  permissions: Permission[];
  pendingRequests: Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>;
}

export const SANDBOX_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'unsafe-inline' 'unsafe-eval'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; img-src 'none'; style-src 'unsafe-inline';">
</head>
<body>
<script>
(function() {
  'use strict';

  let pluginExports = null;
  let permissions = [];
  let manifest = null;
  let messageId = 0;
  const pendingRequests = new Map();
  const contextMenuHandlers = new Map();

  function sendMessage(type, data) {
    var id = data && data.id || ('msg_' + (++messageId));
    var msgData = Object.assign({ id: id, type: type }, data);
    window.parent.postMessage(msgData, '*');
    return id;
  }

  function sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      const id = 'req_' + (++messageId);
      pendingRequests.set(id, { resolve, reject });
      window.parent.postMessage({
        id,
        type: 'request',
        method,
        params
      }, '*');
      
      setTimeout(function() {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  function checkPermission(permission) {
    if (!permissions.includes(permission)) {
      throw new Error('Permission denied: ' + permission);
    }
  }

  function createSandboxedAPI() {
    return {
      app: {
        getInfo() {
          return {
            version: '1.0.0',
            name: 'Air Icon Launcher',
            apiVersion: 'v1'
          };
        }
      },
      
      launcher: {
        async getCategories() {
          checkPermission('launcher.read');
          return sendRequest('launcher.getCategories', []);
        },
        async getItems(categoryId) {
          checkPermission('launcher.read');
          return sendRequest('launcher.getItems', [categoryId]);
        },
        async open(categoryId, itemId) {
          checkPermission('launcher.open');
          return sendRequest('launcher.open', [categoryId, itemId]);
        }
      },
      
      clipboard: {
        async readText() {
          checkPermission('clipboard.readText');
          return sendRequest('clipboard.readText', []);
        },
        async readImage() {
          checkPermission('clipboard.readImage');
          return sendRequest('clipboard.readImage', []);
        },
        async writeText(text) {
          checkPermission('clipboard.writeText');
          return sendRequest('clipboard.writeText', [text]);
        },
        async writeImage(blob) {
          checkPermission('clipboard.writeImage');
          return sendRequest('clipboard.writeImage', [blob]);
        }
      },
      
      storage: {
        _data: new Map(),
        get(key) {
          return this._data.get(key);
        },
        set(key, value) {
          this._data.set(key, value);
        },
        remove(key) {
          this._data.delete(key);
        },
        clear() {
          this._data.clear();
        }
      },
      
      ui: {
        showToast(message, type) {
          type = type || 'info';
          checkPermission('toast');
          sendRequest('ui.showToast', [message, type]);
        },
        registerContextMenuItems(menuType, items) {
          checkPermission('contextMenu');
          var serializableItems = [];
          for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var serializableItem = {
              type: item.type,
              id: item.id,
              label: item.label,
              icon: item.icon,
              order: item.order,
              commandId: null
            };
            var handler = item.handler || item.onClick;
            if (handler && typeof handler === 'function') {
              var commandId = 'ctxMenu_' + item.id;
              contextMenuHandlers.set(commandId, handler);
              serializableItem.commandId = commandId;
            }
            serializableItems.push(serializableItem);
          }
          return sendRequest('ui.registerContextMenuItems', [menuType, serializableItems]);
        },
        unregisterContextMenuItems(menuType) {
          return sendRequest('ui.unregisterContextMenuItems', [menuType]);
        }
      },
      
      _executeContextMenuHandler: function(commandId) {
        var handler = contextMenuHandlers.get(commandId);
        if (handler) {
          return handler();
        }
      },

      events: {
        _listeners: new Map(),
        on(event, callback) {
          var self = this;
          if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
          }
          this._listeners.get(event).add(callback);

          sendRequest('events.on', [event]);

          return function() {
            self._listeners.get(event).delete(callback);
            sendRequest('events.off', [event]);
          };
        },
        off(event, callback) {
          this._listeners.get(event).delete(callback);
          sendRequest('events.off', [event]);
        },
        emit(event) {
          var args = Array.prototype.slice.call(arguments, 1);
          sendRequest('events.emit', [event].concat(args));
        },
        _handleEvent(event, args) {
          var listeners = this._listeners.get(event);
          if (listeners) {
            listeners.forEach(function(cb) {
              try {
                cb.apply(null, args || []);
              } catch (e) {
                console.error('Event listener error:', e);
              }
            });
          }
        }
      },

      commands: {
        _commands: new Map(),
        register(id, handler) {
          this._commands.set(id, handler);
          sendRequest('commands.register', [id]);
        },
        unregister(id) {
          this._commands.delete(id);
          sendRequest('commands.unregister', [id]);
        },
        execute(id) {
          var args = Array.prototype.slice.call(arguments, 1);
          var handler = this._commands.get(id);
          if (handler) {
            return handler.apply(null, args);
          }
          return sendRequest('commands.execute', [id].concat(args));
        },
        _handleCommand(id, args) {
          var handler = this._commands.get(id);
          if (handler) {
            return handler.apply(null, args);
          }
        }
      }
    };
  }

  function executePluginCode(code, manifestData, perms) {
    manifest = manifestData;
    permissions = perms;
    
    var api = createSandboxedAPI();
    
    try {
      var cleanCode = code.trim();
      if (cleanCode.charAt(cleanCode.length - 1) === ';') {
        cleanCode = cleanCode.slice(0, -1);
      }
      
      var wrappedCode = 'return (' + cleanCode + ')(manifest, api);';
      
      var factory = new Function('manifest', 'api', wrappedCode);
      pluginExports = factory(manifest, api);
      
      if (!pluginExports || typeof pluginExports !== 'object') {
        pluginExports = {};
      }
      
      sendMessage('ready', { success: true });
    } catch (error) {
      sendMessage('error', { 
        error: error.message,
        stack: error.stack
      });
    }
  }

  async function callLifecycle(method) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (pluginExports && typeof pluginExports[method] === 'function') {
      try {
        return await pluginExports[method].apply(null, args);
      } catch (error) {
        console.error('Lifecycle error:', method, error);
        throw error;
      }
    }
  }

  window.addEventListener('message', async function(event) {
    var msg = event.data;
    
    if (msg.type === 'response' && pendingRequests.has(msg.id)) {
      var item = pendingRequests.get(msg.id);
      pendingRequests.delete(msg.id);
      
      if (msg.error) {
        item.reject(new Error(msg.error));
      } else {
        item.resolve(msg.result);
      }
      return;
    }
    
    if (msg.type === 'event') {
      var eventType = msg.eventType;
      var eventData = msg.eventData;
      if (eventType && eventData) {
        var api = createSandboxedAPI();
        api.events._handleEvent(eventType, eventData.args || []);
      }
      return;
    }
    
    if (msg.type === 'request' && msg.method === 'ui.executeContextMenuHandler') {
      var commandId = msg.params && msg.params[0];
      if (commandId) {
        var handler = contextMenuHandlers.get(commandId);
        if (handler) {
          handler();
        }
      }
      sendMessage('response', { id: msg.id, result: true });
      return;
    }
    
    if (msg.command === 'init') {
      executePluginCode(msg.code, msg.manifest, msg.permissions);
      return;
    }
    
    if (msg.command === 'onLoad') {
      await callLifecycle('onLoad', createSandboxedAPI());
      sendMessage('response', { id: msg.id, result: true });
      return;
    }
    
    if (msg.command === 'onUnload') {
      await callLifecycle('onUnload');
      sendMessage('response', { id: msg.id, result: true });
      return;
    }
    
    if (msg.command === 'onEnable') {
      await callLifecycle('onEnable', createSandboxedAPI());
      sendMessage('response', { id: msg.id, result: true });
      return;
    }
    
    if (msg.command === 'onDisable') {
      await callLifecycle('onDisable');
      sendMessage('response', { id: msg.id, result: true });
      return;
    }
    
    if (msg.command === 'destroy') {
      pluginExports = null;
      permissions = [];
      manifest = null;
      sendMessage('response', { id: msg.id, result: true });
      return;
    }
  });

  sendMessage('loaded', {});
})();
</script>
</body>
</html>`;
