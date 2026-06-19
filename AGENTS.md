# Air Icon Launcher

Tauri 2 + Vue 3 + Rust 的 Windows 桌面启动器。仅支持 Windows 平台。

## 快速参考

```bash
bun install              # 安装依赖（会自动执行 scripts/patch-solar-icons.cjs）
bun tauri dev            # 启动开发模式（Vite 端口 1420，固定不可改）
bun tauri build          # 构建生产版本（NSIS 安装包）
bun run typecheck        # 前端类型检查 (vue-tsc --noEmit)
bun run check            # 完整检查：typecheck + vite build + cargo check
bun run test             # Rust 测试 (cargo test)
bun run test:unit        # 前端单元测试 (vitest run)
```

## 架构要点

- **双代码库**：`src/` (Vue 3 + TS 前端) + `src-tauri/` (Rust 后端)，通过 Tauri IPC 通信
- **前端**：Vue 3 Composition API (`<script setup>`) + Pinia + Vue Router + SCSS
- **后端**：Rust + Tauri 2，lib 名为 `air_icon_launcher_lib`（避免与 bin 冲突）
- **数据库**：SQLite (rusqlite bundled)
- **插件系统**：iframe 沙箱隔离 + 权限声明 (`manifest.json`)

## 关键约定

### Tauri IPC 调用
**必须**使用 `src/utils/invoke-wrapper.ts` 的 `invoke`，**禁止**直接用 `@tauri-apps/api/core` 的 `invoke`。wrapper 处理了错误解析和页面卸载保护。

### 错误处理
- 前端：`AppError { code, message, details? }`，通过 `invoke-wrapper` 返回 `InvokeResult<T>`（`ok`/`error` 模式）
- 后端：`src-tauri/src/error.rs` 的 `AppError`，使用 `bail!` / `ensure!` 宏

### 代码风格
- TypeScript 严格模式，`noUnusedLocals` + `noUnusedParameters` 开启
- Vue 组件文件名：PascalCase；其他文件：kebab-case
- 提交信息：Conventional Commits（`feat:` / `fix:` / `refactor:` 等），**必须使用中文**

## 开发环境

- Windows 10/11 + Bun 1.x + Rust stable + MSVC Build Tools + WebView2 Runtime
- 开发服务器固定端口 `1420`（`strictPort: true`）
- Vite 忽略监听 `src-tauri/` 目录
- `src-tauri/Cargo.toml` release profile 已优化：LTO、strip、codegen-units=1

## 测试

- 前端测试在 `src/**/__tests__/` 下，用 vitest
- Rust 测试：`bun run test`（实际执行 `cargo test --no-default-features`）
- 没有 CI workflow，PR 前需手动跑 `bun run check` 验证

---

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **air-icon-launcher** (6132 symbols, 12457 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/air-icon-launcher/context` | Codebase overview, check index freshness |
| `gitnexus://repo/air-icon-launcher/clusters` | All functional areas |
| `gitnexus://repo/air-icon-launcher/processes` | All execution flows |
| `gitnexus://repo/air-icon-launcher/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |
| 发布新版本到 GitHub + Gitee | `.claude/skills/release/SKILL.md` |

<!-- gitnexus:end -->
