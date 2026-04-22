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
  sandbox_id?: string;
  nonce?: string;
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
  sandboxId: string;
  nonce: string;
  iframe: HTMLIFrameElement;
  status: SandboxStatus;
  permissions: Permission[];
  pendingRequests: Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>;
}

const SANDBOX_SCRIPT_TEMPLATE = String.raw`
(function() {
  'use strict';

  var SANDBOX_ID = "__SANDBOX_ID__";
  var SANDBOX_NONCE = "__SANDBOX_NONCE__";
  var pluginExports = null;
  var permissions = [];
  var manifest = null;
  var messageId = 0;
  var pendingRequests = new Map();
  var contextMenuHandlers = new Map();

  function buildMessage(type, data) {
    var payload = data || {};
    return Object.assign({
      id: payload.id || ('msg_' + (++messageId)),
      type: type,
      sandbox_id: SANDBOX_ID,
      nonce: SANDBOX_NONCE
    }, payload);
  }

  function sendMessage(type, data) {
    var msg = buildMessage(type, data);
    window.parent.postMessage(msg, '*');
    return msg.id;
  }

  function isTrustedMessage(msg) {
    return !!msg
      && msg.sandbox_id === SANDBOX_ID
      && msg.nonce === SANDBOX_NONCE;
  }

  function sendRequest(method, params) {
    return new Promise(function(resolve, reject) {
      var id = 'req_' + (++messageId);
      pendingRequests.set(id, { resolve: resolve, reject: reject });
      window.parent.postMessage(buildMessage('request', {
        id: id,
        method: method,
        params: params
      }), '*');

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
        getInfo: function() {
          return {
            version: '1.0.0',
            name: 'Air Icon Launcher',
            apiVersion: 'v1'
          };
        }
      },

      launcher: {
        getCategories: async function() {
          checkPermission('launcher.read');
          return sendRequest('launcher.getCategories', []);
        },
        getItems: async function(categoryId) {
          checkPermission('launcher.read');
          return sendRequest('launcher.getItems', [categoryId]);
        },
        open: async function(categoryId, itemId) {
          checkPermission('launcher.open');
          return sendRequest('launcher.open', [categoryId, itemId]);
        }
      },

      clipboard: {
        readText: async function() {
          checkPermission('clipboard.readText');
          return sendRequest('clipboard.readText', []);
        },
        readImage: async function() {
          checkPermission('clipboard.readImage');
          return sendRequest('clipboard.readImage', []);
        },
        writeText: async function(text) {
          checkPermission('clipboard.writeText');
          return sendRequest('clipboard.writeText', [text]);
        },
        writeImage: async function(blob) {
          checkPermission('clipboard.writeImage');
          return sendRequest('clipboard.writeImage', [blob]);
        }
      },

      storage: {
        _data: new Map(),
        get: function(key) {
          return this._data.get(key);
        },
        set: function(key, value) {
          this._data.set(key, value);
        },
        remove: function(key) {
          this._data.delete(key);
        },
        clear: function() {
          this._data.clear();
        }
      },

      ui: {
        showToast: function(message, type) {
          checkPermission('toast');
          return sendRequest('ui.showToast', [message, type || 'info']);
        },
        registerContextMenuItems: function(menuType, items) {
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
        unregisterContextMenuItems: function(menuType) {
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
        on: function(event, callback) {
          var self = this;
          if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
          }
          this._listeners.get(event).add(callback);
          sendRequest('events.on', [event]);

          return function() {
            var listeners = self._listeners.get(event);
            if (listeners) {
              listeners.delete(callback);
            }
            sendRequest('events.off', [event]);
          };
        },
        off: function(event, callback) {
          var listeners = this._listeners.get(event);
          if (listeners) {
            listeners.delete(callback);
          }
          sendRequest('events.off', [event]);
        },
        emit: function(event) {
          var args = Array.prototype.slice.call(arguments, 1);
          sendRequest('events.emit', [event].concat(args));
        },
        _handleEvent: function(event, args) {
          var listeners = this._listeners.get(event);
          if (listeners) {
            listeners.forEach(function(cb) {
              try {
                cb.apply(null, args || []);
              } catch (error) {
                console.error('Event listener error:', error);
              }
            });
          }
        }
      },

      commands: {
        _commands: new Map(),
        register: function(id, handler) {
          this._commands.set(id, handler);
          sendRequest('commands.register', [id]);
        },
        unregister: function(id) {
          this._commands.delete(id);
          sendRequest('commands.unregister', [id]);
        },
        execute: function(id) {
          var args = Array.prototype.slice.call(arguments, 1);
          var handler = this._commands.get(id);
          if (handler) {
            return handler.apply(null, args);
          }
          return sendRequest('commands.execute', [id].concat(args));
        },
        _handleCommand: function(id, args) {
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

      sendMessage('ready', { result: true });
    } catch (error) {
      sendMessage('error', {
        error: error && error.message ? error.message : String(error)
      });
    }
  }

  async function callLifecycle(method) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (pluginExports && typeof pluginExports[method] === 'function') {
      return pluginExports[method].apply(null, args);
    }
  }

  window.addEventListener('message', async function(event) {
    if (event.source !== window.parent) {
      return;
    }

    var msg = event.data;
    if (!isTrustedMessage(msg)) {
      return;
    }

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
      if (msg.eventType && msg.eventData) {
        createSandboxedAPI().events._handleEvent(msg.eventType, msg.eventData.args || []);
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
      try {
        await callLifecycle('onLoad', createSandboxedAPI());
        sendMessage('response', { id: msg.id, result: true });
      } catch (error) {
        sendMessage('response', { id: msg.id, error: error && error.message ? error.message : String(error) });
      }
      return;
    }

    if (msg.command === 'onUnload') {
      try {
        await callLifecycle('onUnload');
        sendMessage('response', { id: msg.id, result: true });
      } catch (error) {
        sendMessage('response', { id: msg.id, error: error && error.message ? error.message : String(error) });
      }
      return;
    }

    if (msg.command === 'onEnable') {
      try {
        await callLifecycle('onEnable', createSandboxedAPI());
        sendMessage('response', { id: msg.id, result: true });
      } catch (error) {
        sendMessage('response', { id: msg.id, error: error && error.message ? error.message : String(error) });
      }
      return;
    }

    if (msg.command === 'onDisable') {
      try {
        await callLifecycle('onDisable');
        sendMessage('response', { id: msg.id, result: true });
      } catch (error) {
        sendMessage('response', { id: msg.id, error: error && error.message ? error.message : String(error) });
      }
      return;
    }

    if (msg.command === 'destroy') {
      pluginExports = null;
      permissions = [];
      manifest = null;
      pendingRequests.clear();
      contextMenuHandlers.clear();
      sendMessage('response', { id: msg.id, result: true });
    }
  });

  sendMessage('loaded', { result: true });
})();
`;

export function renderSandboxHtml(sandboxId: string, nonce: string): string {
  const script = SANDBOX_SCRIPT_TEMPLATE
    .replace(/__SANDBOX_ID__/g, sandboxId)
    .replace(/__SANDBOX_NONCE__/g, nonce);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'unsafe-inline' 'unsafe-eval'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; img-src 'none'; style-src 'unsafe-inline';">
</head>
<body>
<script>${script}<\/script>
</body>
</html>`;
}
