# Contributing to Air Icon Launcher

感谢你对 Air Icon Launcher 项目的兴趣！我们欢迎各种形式的贡献，包括但不限于：错误报告、功能建议、代码提交、文档改进等。

## 📋 开发环境准备

### 前置要求

- **操作系统**: Windows 10 / 11（当前仅支持 Windows）
- **运行时**:
  - [Bun](https://bun.sh/) 1.x 或更高版本
  - [Rust](https://www.rust-lang.org/tools/install) stable toolchain
  - [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (MSVC)
  - [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

### 安装步骤

1. **克隆仓库**
   ```bash
   git clone https://github.com/your-username/air-icon-launcher.git
   cd air-icon-launcher
   ```

2. **安装前端依赖**
   ```bash
   bun install
   ```

3. **启动开发模式**
   ```bash
   bun tauri dev
   ```

## 🏗️ 项目结构

```
air-icon-launcher/
├── src/                    # 前端源码 (Vue 3 + TypeScript)
│   ├── components/         # Vue 组件
│   ├── composables/        # 组合式函数
│   ├── stores/             # Pinia 状态管理
│   ├── plugins/            # 插件系统
│   ├── utils/              # 工具函数
│   └── views/              # 页面视图
├── src-tauri/              # 后端源码 (Rust)
│   └── src/
│       ├── commands/       # Tauri 命令
│       ├── clipboard.rs    # 剪贴板功能
│       ├── plugins.rs      # 插件管理
│       └── ...
└── package.json            # 前端依赖配置
```

## 🎯 开发规范

### 代码风格

- **TypeScript**: 使用严格模式，避免使用 `any` 类型
- **Vue 3**: 使用 Composition API (`<script setup>`)
- **Rust**: 遵循 Rust 官方风格指南，使用 `cargo fmt` 格式化
- **命名规范**: 
  - 变量/函数: camelCase
  - 类型/接口: PascalCase
  - 常量: UPPER_SNAKE_CASE
  - 文件名: kebab-case 或 PascalCase（组件）

### 错误处理

项目采用统一的错误处理体系：

**前端 (TypeScript)**:
```typescript
import { invoke } from "./utils/invoke-wrapper";

// ✅ 正确方式 - 使用统一的 invoke wrapper
const result = await invoke<DataType>("command_name", { arg: value });
if (!result.ok) {
    console.error(result.error.code, result.error.message);
    return;
}

// ❌ 避免方式 - 直接使用原生 invoke
import { invoke } from "@tauri-apps/api/core";
```

**后端 (Rust)**:
```rust
use crate::error::{AppError, AppResult, bail, ensure};

// ✅ 正确方式 - 使用 AppResult 和宏
fn example_fn() -> AppResult<String> {
    ensure!(!condition, "条件不满足");
    Ok("success".to_string())
}

// ❌ 避免方式 - 直接返回 Error
```

### 提交信息格式

遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
<type>(<scope>): <subject>

<body>

<footer>
```

**类型 (type)**:
- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档更新
- `style`: 代码格式调整（不影响功能）
- `refactor`: 重构（既不是新功能也不是修复）
- `perf`: 性能优化
- `test`: 测试相关
- `chore`: 构建过程或辅助工具的变动

**示例**:
```
feat(launcher): add drag-and-drop reordering for launcher items

Implement drag-and-drop functionality to allow users to reorder
launcher items within a category by dragging.

Closes #123
```

## 🧪 测试

在提交 PR 前，请确保：

1. **前端类型检查通过**
   ```bash
   bun run typecheck
   ```

2. **前后端综合检查**
   ```bash
   bun run check
   ```

3. **Rust 测试通过**（如有）
   ```bash
   bun run test
   ```

4. **开发模式正常运行**
   ```bash
   bun tauri dev
   ```

## 🐛 报告问题

当发现 bug 时，请提供以下信息：

1. **问题描述**: 清晰描述问题现象
2. **复现步骤**: 详细列出如何复现该问题
3. **期望行为**: 描述你期望的正确行为
4. **实际行为**: 描述实际发生的情况
5. **环境信息**:
   - 操作系统版本
   - 应用版本号
   - 相关日志或截图

## 💡 功能建议

欢迎提出新功能建议！请在 Issue 中说明：

1. **功能描述**: 这个功能要解决什么问题？
2. **使用场景**: 在什么情况下会用到这个功能？
3. **预期效果**: 你希望这个功能如何工作？

## 🔄 Pull Request 流程

1. **Fork 仓库** 并创建特性分支
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **进行开发** 并遵循上述代码规范

3. **测试你的更改** 确保所有检查通过

4. **提交你的更改** 使用规范的 commit message

5. **Push 到你的 Fork**
   ```bash
   git push origin feature/your-feature-name
   ```

6. **创建 Pull Request** 并填写 PR 模板

### PR 要求

- [ ] 代码遵循项目规范
- [ ] 所有类型检查通过 (`bun run typecheck`)
- [ ] 所有测试通过 (`bun run check`)
- [ ] Commit message 符合 Conventional Commits 规范
- [ ] 更新相关文档（如需要）

## 📚 文档

如果你改进了功能或添加了新功能，请考虑：

1. **更新 README.md**（如涉及用户可见的功能）
2. **添加代码注释**（特别是复杂逻辑）
3. **更新类型定义**（如添加了新的数据结构）

## 🤝 社区准则

- **尊重他人**: 保持专业和友善的态度
- **建设性反馈**: 提供具体、可操作的建议
- **包容性**: 欢迎来自不同背景的贡献者
- **安全第一**: 发现安全问题请私下报告，不要公开 Issue

## 📄 许可证

通过贡献代码，你同意你的贡献将在 [MIT License](LICENSE) 下授权。

---

感谢你的贡献！🎉
