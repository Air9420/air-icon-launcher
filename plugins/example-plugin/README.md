# 欢迎插件 (Example Plugin)

这是一个简单的示例插件，用于展示 Air Icon Launcher 插件系统的基本功能。

## 功能

- 启动时显示欢迎消息
- 提供自定义命令：
  - `showWelcome` - 显示欢迎消息
  - `listCategories` - 列出当前分类数量
  - `showStorage` - 演示存储功能

## 安装

1. 打开 Air Icon Launcher
2. 进入 设置 -> 插件管理
3. 点击"从文件夹安装"
4. 选择此插件目录 (`example-plugin`)

## 开发指南

### 插件结构

```
example-plugin/
├── manifest.json    # 插件清单
├── main.js          # 插件入口
└── README.md        # 说明文档
```

### manifest.json

```json
{
  "id": "com.example.welcome-plugin",
  "name": "欢迎插件",
  "version": "1.0.0",
  "description": "插件描述",
  "author": "作者名称",
  "main": "main.js"
}
```

### main.js

插件入口文件需要导出一个函数，该函数接收 `manifest` 和 `api` 两个参数：

```javascript
(function(manifest, api) {
  // 使用 api 注册功能
  
  return {
    activate: function() {
      // 插件激活时调用
    },
    deactivate: function() {
      // 插件停用时调用
    }
  };
});
```

## API 参考

### 应用信息

- `api.getAppInfo()` - 获取应用信息

### 数据操作

- `api.getCategories()` - 获取所有分类
- `api.getLauncherItems(categoryId)` - 获取指定分类的启动项
- `api.launchItem(categoryId, itemId)` - 启动指定项目

### 存储

- `api.storage.get(key)` - 获取存储值
- `api.storage.set(key, value)` - 设置存储值
- `api.storage.remove(key)` - 删除存储值
- `api.storage.clear()` - 清空存储

### UI

- `api.showToast(message, type)` - 显示提示消息
  - type: 'info' | 'success' | 'error'

### 事件

- `api.on(event, callback)` - 监听事件
- `api.off(event, callback)` - 取消监听
- `api.emit(event, ...args)` - 触发事件

### 命令

- `api.registerCommand(commandId, handler)` - 注册命令
- `api.unregisterCommand(commandId)` - 注销命令
- `api.executeCommand(commandId, ...args)` - 执行命令

## 注意事项

1. 插件运行在隔离的 iframe 沙箱环境中
2. 插件存储数据是隔离的，不同插件之间无法互相访问
3. 命令 ID 会自动添加插件前缀，如 `com.example.welcome-plugin:showWelcome`
