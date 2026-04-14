(function(manifest, api) {
  'use strict';

  console.log('[Plugin: ' + manifest.name + '] 正在初始化...');

  var savedApi = api;

  function testSandboxIsolation() {
    console.log('[Plugin: ' + manifest.name + '] ========== 沙箱隔离测试开始 ==========');

    console.log('[Plugin: ' + manifest.name + '] [测试1] 尝试读取 localStorage...');
    try {
      var storage = localStorage;
      storage.setItem('test', 'test');
      storage.removeItem('test');
      console.log('[Plugin: ' + manifest.name + '] [测试1] ❌ localStorage 可用 - 隔离失败!');
    } catch (e) {
      console.log('[Plugin: ' + manifest.name + '] [测试1] ✅ localStorage 被阻止:', e.message);
    }

    console.log('[Plugin: ' + manifest.name + '] [测试2] 尝试访问 document.body...');
    try {
      var body = document.body;
      if (body) {
        console.log('[Plugin: ' + manifest.name + '] [测试2] ⚠️ document.body 存在但尝试操作...');
        try {
          document.body.innerHTML = '<script>alert(1)</script>';
          console.log('[Plugin: ' + manifest.name + '] [测试2] ❌ document.body 可修改 - 隔离失败!');
        } catch (e) {
          console.log('[Plugin: ' + manifest.name + '] [测试2] ✅ document.body 无法修改:', e.message);
        }
      }
    } catch (e) {
      console.log('[Plugin: ' + manifest.name + '] [测试2] ✅ document.body 被阻止:', e.message);
    }

    console.log('[Plugin: ' + manifest.name + '] [测试3] 尝试访问 sessionStorage...');
    try {
      var sStorage = sessionStorage;
      console.log('[Plugin: ' + manifest.name + '] [测试3] ❌ sessionStorage 可用 - 隔离失败!');
    } catch (e) {
      console.log('[Plugin: ' + manifest.name + '] [测试3] ✅ sessionStorage 被阻止:', e.message);
    }

    console.log('[Plugin: ' + manifest.name + '] [测试4] 尝试越权调用 clipboard.readText (未授权)...');
    savedApi.clipboard.readText().then(function(text) {
      console.log('[Plugin: ' + manifest.name + '] [测试4] ❌ 越权读取剪贴板成功 - 隔离失败!');
    }).catch(function(err) {
      console.log('[Plugin: ' + manifest.name + '] [测试4] ✅ 越权调用被阻止:', err.message);
    });

    console.log('[Plugin: ' + manifest.name + '] [测试5] 尝试访问 indexedDB...');
    try {
      var idb = indexedDB;
      var testDb = idb.open('test_sandbox_db');
      testDb.onsuccess = function() {
        testDb.result.close();
        idb.deleteDatabase('test_sandbox_db');
        console.log('[Plugin: ' + manifest.name + '] [测试5] ❌ indexedDB 可用 - 隔离失败!');
      };
      testDb.onerror = function() {
        console.log('[Plugin: ' + manifest.name + '] [测试5] ✅ indexedDB 操作被阻止');
      };
    } catch (e) {
      console.log('[Plugin: ' + manifest.name + '] [测试5] ✅ indexedDB 被阻止:', e.message);
    }

    console.log('[Plugin: ' + manifest.name + '] [测试6] 尝试修改 parent.location...');
    try {
      window.parent.location.href = 'http://evil.com';
      console.log('[Plugin: ' + manifest.name + '] [测试6] ❌ parent.location 可修改 - 隔离失败!');
    } catch (e) {
      console.log('[Plugin: ' + manifest.name + '] [测试6] ✅ parent.location 无法修改:', e.message);
    }

    console.log('[Plugin: ' + manifest.name + '] [测试7] 尝试调用未授权的 Tauri API (launcher.open)...');
    savedApi.launcher.open('test-category', 'test-item').then(function() {
      console.log('[Plugin: ' + manifest.name + '] [测试7] ❌ launcher.open 成功 - 隔离失败!');
    }).catch(function(err) {
      console.log('[Plugin: ' + manifest.name + '] [测试7] ✅ launcher.open 被阻止:', err.message);
    });

    console.log('[Plugin: ' + manifest.name + '] ========== 沙箱隔离测试结束 ==========');
    console.log('[Plugin: ' + manifest.name + '] ✅ 标记的测试项表示沙箱隔离有效');
  }

  function showWelcome() {
    var appInfo = savedApi.app.getInfo();
    savedApi.ui.showToast('欢迎使用 ' + appInfo.name + '！这是来自 ' + manifest.name + ' 的问候。', 'success');
  }

  function listCategories() {
    savedApi.launcher.getCategories().then(function(categories) {
      var count = categories.length;
      savedApi.ui.showToast('当前共有 ' + count + ' 个分类', 'info');
      console.log('[Plugin: ' + manifest.name + '] 分类列表:', categories);
    }).catch(function(err) {
      console.error('[Plugin: ' + manifest.name + '] 获取分类失败:', err);
    });
  }

  function showStorage() {
    savedApi.storage.set('lastAccessTime', Date.now());
    savedApi.storage.set('accessCount', (savedApi.storage.get('accessCount') || 0) + 1);
    
    var accessCount = savedApi.storage.get('accessCount');
    savedApi.ui.showToast('这是您第 ' + accessCount + ' 次使用此功能', 'info');
  }

  function toggleExampleFlag() {
    var next = !savedApi.storage.get('exampleFlag');
    savedApi.storage.set('exampleFlag', next);
    savedApi.ui.showToast('exampleFlag: ' + (next ? 'ON' : 'OFF'), next ? 'success' : 'info');
  }

  function registerCommands() {
    savedApi.commands.register('showWelcome', showWelcome);
    savedApi.commands.register('listCategories', listCategories);
    savedApi.commands.register('showStorage', showStorage);
    savedApi.commands.register('toggleExampleFlag', toggleExampleFlag);
    savedApi.commands.register('testSandbox', testSandboxIsolation);
    
    console.log('[Plugin: ' + manifest.name + '] 已注册命令: showWelcome, listCategories, showStorage, toggleExampleFlag, testSandbox');
  }

  function registerContextMenu() {
    console.log('[Plugin: ' + manifest.name + '] 注册右键菜单项...');
    
    savedApi.ui.registerContextMenuItems('Icon-Item', [
      { type: 'separator', id: 'sep', order: 1000 },
      { 
        type: 'item', 
        id: 'welcome', 
        label: '插件问候', 
        order: 1010,
        onClick: showWelcome
      },
      { 
        type: 'item', 
        id: 'storage', 
        label: '插件存储次数', 
        order: 1020,
        onClick: showStorage
      },
      {
        type: 'item',
        id: 'flag',
        label: '切换 Example Flag',
        order: 1030,
        onClick: toggleExampleFlag
      },
      {
        type: 'item',
        id: 'list',
        label: '输出分类列表',
        order: 1040,
        onClick: listCategories
      },
      {
        type: 'item',
        id: 'testSandbox',
        label: '🧪 测试沙箱隔离',
        order: 1050,
        onClick: testSandboxIsolation
      }
    ]);
    
    console.log('[Plugin: ' + manifest.name + '] 已注册右键菜单项');
  }

  function cleanup() {
    savedApi.ui.unregisterContextMenuItems();
    savedApi.commands.unregister('showWelcome');
    savedApi.commands.unregister('listCategories');
    savedApi.commands.unregister('showStorage');
    savedApi.commands.unregister('toggleExampleFlag');
    savedApi.commands.unregister('testSandbox');
    console.log('[Plugin: ' + manifest.name + '] 已清理资源');
  }

  return {
    onLoad: function(pluginApi) {
      console.log('[Plugin: ' + manifest.name + '] onLoad 被调用');
      savedApi = pluginApi;
      
      registerCommands();
      
      savedApi.events.on('plugin:loaded', function(data) {
        console.log('[Plugin: ' + manifest.name + '] 插件加载事件:', data);
      });
      
      savedApi.ui.showToast(manifest.name + ' 已加载', 'success');
    },
    
    onEnable: function(pluginApi) {
      console.log('[Plugin: ' + manifest.name + '] onEnable 被调用');
      if (pluginApi) {
        savedApi = pluginApi;
      }
      
      registerContextMenu();
      
      console.log('[Plugin: ' + manifest.name + '] 插件已启用，右键菜单选择"测试沙箱隔离"可验证隔离效果');
    },
    
    onDisable: function() {
      console.log('[Plugin: ' + manifest.name + '] onDisable 被调用');
      cleanup();
    },
    
    onUnload: function() {
      console.log('[Plugin: ' + manifest.name + '] onUnload 被调用');
      cleanup();
    },
    
    activate: function(pluginApi) {
      console.log('[Plugin: ' + manifest.name + '] activate 被调用 (兼容旧版)');
      savedApi = pluginApi;
      
      registerCommands();
      registerContextMenu();
      
      pluginApi.ui.showToast(manifest.name + ' 已激活', 'success');
    },
    
    deactivate: function() {
      console.log('[Plugin: ' + manifest.name + '] deactivate 被调用 (兼容旧版)');
      cleanup();
    }
  };
});
