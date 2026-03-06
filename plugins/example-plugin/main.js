(function(manifest, api) {
  'use strict';

  console.log(`[Plugin: ${manifest.name}] 正在初始化...`);

  api.on('plugin:loaded', function(data) {
    console.log(`[Plugin: ${manifest.name}] 插件加载事件:`, data);
  });

  api.on('app:ready', function() {
    console.log(`[Plugin: ${manifest.name}] 应用已就绪`);
  });

  api.registerCommand('showWelcome', function() {
    const appInfo = api.getAppInfo();
    api.showToast(`欢迎使用 ${appInfo.name}！这是来自 ${manifest.name} 的问候。`, 'success');
  });

  api.registerCommand('listCategories', function() {
    const categories = api.getCategories();
    const count = categories.length;
    api.showToast(`当前共有 ${count} 个分类`, 'info');
    console.log(`[Plugin: ${manifest.name}] 分类列表:`, categories);
  });

  api.registerCommand('showStorage', function() {
    api.storage.set('lastAccessTime', Date.now());
    api.storage.set('accessCount', (api.storage.get('accessCount') || 0) + 1);
    
    const accessCount = api.storage.get('accessCount');
    api.showToast(`这是您第 ${accessCount} 次使用此功能`, 'info');
  });

  console.log(`[Plugin: ${manifest.name}] 已注册命令: showWelcome, listCategories, showStorage`);

  return {
    activate: function() {
      console.log(`[Plugin: ${manifest.name}] 已激活`);
      api.showToast(`${manifest.name} 已加载`, 'success');
    },
    
    deactivate: function() {
      console.log(`[Plugin: ${manifest.name}] 已停用`);
      api.unregisterCommand('showWelcome');
      api.unregisterCommand('listCategories');
      api.unregisterCommand('showStorage');
    }
  };
});
