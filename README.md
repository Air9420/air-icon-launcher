# Air Icon Launcher

一个基于 Tauri 的桌面应用，用于收纳与分类桌面应用程序图标，提供轻量的启动与管理体验。

## 功能概览

- 图标分类与分组管理
- 拖拽排序与位置调整
- 右键菜单与快捷操作
- 设置页与启动项编辑

## 技术栈

- Tauri 2
- Vue 3 + Vite + TypeScript
- Pinia（含持久化）
- Vue Router

## 开发环境

- Windows 10/11
- Bun
- Rust 工具链（含 cargo）
- Tauri CLI

## 本地开发

安装依赖：

```bash
bun install
```

启动 Tauri 开发：

```bash
bun tauri dev
```

仅启动前端：

```bash
bun run dev
```

## 构建发布

```bash
bun tauri build
```

## 项目结构

- src：前端页面与组件
- src-tauri：Tauri 后端与配置
- public：静态资源

## 推荐 IDE

- VS Code + Vue - Official + Tauri + rust-analyzer
