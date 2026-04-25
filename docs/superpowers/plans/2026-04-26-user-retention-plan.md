# 用户留存优化：四阶段实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建分层决策规则引擎 + 行为反馈 + AI补位 + 规则自进化的用户留存系统

**Architecture:** 四阶段渐进式实施。Phase A 重构规则引擎为分层决策 Pipeline；Phase B 添加 Override 系统和行为反馈；Phase C 让 AI 只处理不确定/可疑部分；Phase D 实现 AI → 规则引擎的自进化闭环。

**Tech Stack:** Vue 3 + TypeScript + Pinia + Tauri (Rust) + Vitest

**Spec:** `docs/superpowers/specs/2026-04-26-user-retention-design.md`

---

## 文件影响地图

### 新建文件

| 文件 | 职责 |
|------|------|
| `src/utils/classification/normalizer.ts` | Normalization 层：标准化 app 数据为 NormalizedApp |
| `src/utils/classification/types.ts` | 分类系统所有类型定义 |
| `src/utils/classification/exe-map.ts` | EXE_MAP: O(1) exe → 分类映射 |
| `src/utils/classification/pipeline.ts` | 3层决策 Pipeline + Heuristics + Override 查找 |
| `src/utils/classification/rules.ts` | CATEGORY_RULES 定义（含 publisherKeywords） |
| `src/utils/classification/heuristics.ts` | PATH_HEURISTICS 定义 |
| `src/utils/classification/index.ts` | 统一导出 |
| `src/utils/classification/__tests__/pipeline.test.ts` | Pipeline 测试（含置信度） |
| `src/stores/overrideStore.ts` | Override 持久化 + 衰减 + 三层 key 查找 |
| `src/composables/useSearchToLaunch.ts` | searchToLaunch 信号收集 |
| `src/composables/useLaunchDuration.ts` | launchDurations 简化版 |
| `src/composables/useContextTrigger.ts` | Context Trigger 发现与推荐 |
| `src/utils/classification/ai-filter.ts` | AI 输入过滤 + Suspicion Signals |
| `src/utils/classification/ai-cache.ts` | AI 结果缓存 |
| `src/utils/classification/pattern-discovery.ts` | 模式发现（Phase D） |
| `src/utils/classification/rule-proposal.ts` | 规则提案 + 持久化（Phase D） |

### 修改文件

| 文件 | 改动 |
|------|------|
| `src-tauri/src/commands/installed_apps.rs` | 添加 publisher 字段 |
| `src/utils/ai-organizer.ts` | 重构：使用新 Pipeline 替代旧加权模型 |
| `src/utils/ai-organizer-ai.ts` | 适配新输入格式 + AI 过滤 |
| `src/views/AIOrganizer.vue` | 适配 confidence + Override + 新分类审批 |
| `src/stores/statsStore.ts` | 添加 searchSessions + schema 迁移 |
| `src/stores/launcherStore.ts` | 集成 Override 查找 |
| `src/composables/useSearch.ts` | 集成 searchToLaunch |
| `src/composables/useHomePageState.ts` | 集成 Context Trigger |
| `src/stores/index.ts` | 导出 overrideStore |

---

## Phase A: 分层决策规则引擎

### Task A1: 创建类型定义

**Files:**
- Create: `src/utils/classification/types.ts`

- [ ] **Step 1: 创建 types.ts**

```typescript
export type CategoryKey = string;

export type NormalizedApp = {
    name: string;
    path: string;
    icon_base64: string | null;
    source: string;
    publisher: string | null;
    nameTokens: string[];
    pathTokens: string[];
    publisherToken: string | null;
    exeName: string;
};

export type CategoryRule = {
    key: CategoryKey;
    name: string;
    description: string;
    exactTerms?: string[];
    keywords?: string[];
    pathKeywords?: string[];
    publisherKeywords?: string[];
};

export type Candidate = {
    categoryKey: CategoryKey;
    confidence: number;
    reason: string;
};

export type ClassificationResult = {
    rule: CategoryRule;
    reason: string;
    confidence: number;
    app: NormalizedApp;
};

export type PathHeuristic = {
    pathToken: string;
    categoryKey: CategoryKey;
    reason: string;
};

export type CategoryOverride = {
    key: string;
    categoryKey: CategoryKey;
    confidence: number;
    source: "user" | "ai";
    createdAt: number;
    lastUsedAt: number;
    hitCount: number;
    decayFactor: number;
};
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/classification/types.ts
git commit -m "feat: add classification type definitions"
```

### Task A2: 创建 Normalization 层

**Files:**
- Create: `src/utils/classification/normalizer.ts`

- [ ] **Step 1: 创建 normalizer.ts**

```typescript
import type { NormalizedApp } from "./types";

export function normalizePublisher(raw: string): string {
    return raw
        .normalize("NFKC")
        .toLowerCase()
        .replace(/\b(inc|llc|ltd|gmbh|co|corp|corporation|limited|s\.?r\.?o|pvt|ab|sa|nv|bv|ag|kg)\b/g, "")
        .replace(/[.,]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

export function cleanToken(token: string): string {
    return token
        .replace(/\d+(\.\d+)*/g, "")
        .replace(/(x64|x86|win64|win32)/gi, "")
        .trim();
}

export function normalizeTextForMatching(text: string): string {
    return text
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[()[\]{}\-_.]/g, " ")
        .split(/\s+/)
        .map(cleanToken)
        .filter(t => t.length > 0)
        .join(" ");
}

export function extractExeName(path: string): string {
    const normalized = path.replace(/\\/g, "/");
    const filename = normalized.split("/").pop() || "";
    return filename.toLowerCase();
}

export function tokenizePath(path: string): string[] {
    return path
        .replace(/\\/g, "/")
        .split("/")
        .filter(Boolean)
        .map(segment => normalizeTextForMatching(segment))
        .filter(t => t.length > 0);
}

export function tokenizeName(name: string): string[] {
    return normalizeTextForMatching(name)
        .split(" ")
        .filter(t => t.length > 0);
}

export function normalizeApp(raw: {
    name: string;
    path: string;
    icon_base64?: string | null;
    source: string;
    publisher?: string | null;
}): NormalizedApp {
    const publisherToken = raw.publisher
        ? normalizePublisher(raw.publisher)
        : null;

    return {
        name: raw.name,
        path: raw.path,
        icon_base64: raw.icon_base64 ?? null,
        source: raw.source,
        publisher: raw.publisher ?? null,
        nameTokens: tokenizeName(raw.name),
        pathTokens: tokenizePath(raw.path),
        publisherToken: publisherToken && publisherToken.length > 0 ? publisherToken : null,
        exeName: extractExeName(raw.path),
    };
}

export function matchPublisher(publisher: string, keyword: string): boolean {
    const pubTokens = publisher.split(" ");
    const kwTokens = keyword.split(" ");
    return kwTokens.every(t => pubTokens.includes(t));
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/classification/normalizer.ts
git commit -m "feat: add normalization layer for classification"
```

### Task A3: 创建 EXE_MAP

**Files:**
- Create: `src/utils/classification/exe-map.ts`

- [ ] **Step 1: 创建 exe-map.ts**

```typescript
import type { CategoryKey } from "./types";

export const EXE_MAP: Record<string, CategoryKey> = {
    "chrome.exe": "browser",
    "firefox.exe": "browser",
    "msedge.exe": "browser",
    "brave.exe": "browser",
    "opera.exe": "browser",
    "vivaldi.exe": "browser",
    "arc.exe": "browser",
    "wechat.exe": "office",
    "dingtalk.exe": "office",
    "feishu.exe": "office",
    "telegram.exe": "office",
    "discord.exe": "office",
    "qq.exe": "office",
    "steam.exe": "gaming",
    "epicgameslauncher.exe": "gaming",
    "wegame.exe": "gaming",
    "obs64.exe": "design",
    "obs32.exe": "design",
    "potplayer.exe": "media",
    "potplayer64.exe": "media",
    "vlc.exe": "media",
    "ollama.exe": "ai",
    "code.exe": "development",
    "devenv.exe": "development",
    "idea64.exe": "development",
    "pycharm64.exe": "development",
    "webstorm64.exe": "development",
    "goland64.exe": "development",
    "clion64.exe": "development",
    "rider64.exe": "development",
    "datagrip64.exe": "development",
    "cursor.exe": "development",
    "windsurf.exe": "development",
    "trae.exe": "development",
    "notion.exe": "office",
    "obsidian.exe": "office",
    "typora.exe": "office",
    "word.exe": "office",
    "excel.exe": "office",
    "powerpnt.exe": "office",
    "outlook.exe": "office",
    "photoshop.exe": "design",
    "illustrator.exe": "design",
    "figma.exe": "design",
    "blender.exe": "design",
    "7z.exe": "system",
    "winrar.exe": "system",
    "wps.exe": "office",
};

export function lookupExeMap(exeName: string): CategoryKey | null {
    return EXE_MAP[exeName.toLowerCase()] ?? null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/classification/exe-map.ts
git commit -m "feat: add EXE_MAP for O(1) exe-to-category lookup"
```

### Task A4: 创建 CATEGORY_RULES（含 publisherKeywords）

**Files:**
- Create: `src/utils/classification/rules.ts`

- [ ] **Step 1: 创建 rules.ts**

迁移现有 `ai-organizer.ts` 中的 `ORGANIZER_CATEGORY_RULES`，添加 `publisherKeywords` 字段。保留所有现有 exactTerms、keywords、pathKeywords，新增 publisherKeywords。

```typescript
import type { CategoryRule } from "./types";

export const CATEGORY_RULES: CategoryRule[] = [
    {
        key: "browser",
        name: "浏览器",
        description: "网页浏览工具",
        exactTerms: ["浏览器", "browser"],
        keywords: ["chrome", "firefox", "edge", "safari", "opera", "brave", "vivaldi", "arc"],
        publisherKeywords: ["google", "mozilla", "microsoft edge", "brave software", "vivaldi"],
    },
    {
        key: "development",
        name: "开发工具",
        description: "编程IDE、编辑器、终端、版本控制",
        exactTerms: ["开发", "ide", "编辑器", "终端", "编译器"],
        keywords: ["visual studio", "vscode", "intellij", "pycharm", "webstorm", "goland", "clion", "rider", "terminal", "git", "docker", "node", "python", "java", "rust", "cargo", "npm", "yarn", "cursor", "windsurf", "trae"],
        pathKeywords: ["jetbrains", "microsoft visual studio", "python3", "nodejs", "docker"],
        publisherKeywords: ["jetbrains", "microsoft visual studio", "github", "docker", "git for windows", "python software"],
    },
    {
        key: "design",
        name: "设计创作",
        description: "图像编辑、3D建模、UI设计",
        exactTerms: ["设计", "photoshop", "illustrator", "figma", "blender"],
        keywords: ["adobe", "photoshop", "illustrator", "figma", "sketch", "blender", "after effects", "premiere", "canva", "coreldraw"],
        pathKeywords: ["adobe"],
        publisherKeywords: ["adobe systems", "blender foundation", "figma", "canva"],
    },
    {
        key: "office",
        name: "办公沟通",
        description: "办公套件、即时通讯、邮件、会议",
        exactTerms: ["办公", "聊天", "邮件", "会议"],
        keywords: ["word", "excel", "powerpoint", "outlook", "wechat", "微信", "qq", "钉钉", "飞书", "telegram", "discord", "slack", "teams", "notion", "obsidian", "wps"],
        pathKeywords: ["tencent", "dingtalk", "feishu", "microsoft office"],
        publisherKeywords: ["tencent", "microsoft corporation", "slack", "notion labs", "obsidian", "atlassian"],
    },
    {
        key: "gaming",
        name: "游戏平台",
        description: "游戏启动器、游戏平台",
        exactTerms: ["游戏", "steam", "epic"],
        keywords: ["steam", "epic", "wegame", "gog", "origin", "ubisoft", "battle.net", "xbox"],
        pathKeywords: ["steam", "epic games"],
        publisherKeywords: ["valve", "epic games", "riot games", "ubisoft", "blizzard"],
    },
    {
        key: "media",
        name: "影音播放",
        description: "视频播放器、音乐播放器、录音",
        exactTerms: ["播放器", "音乐", "视频"],
        keywords: ["vlc", "potplayer", "spotify", "foobar", "aimp", "musicbee", "netease cloud", "qq音乐"],
        publisherKeywords: ["video lan", "kakao", "spotify"],
    },
    {
        key: "system",
        name: "系统工具",
        description: "文件管理、系统优化、压缩解压",
        exactTerms: ["系统", "管理", "优化"],
        keywords: ["7-zip", "winrar", "ccleaner", "everything", "total commander", "poweriso", "rufus"],
        pathKeywords: ["utilities", "security"],
        publisherKeywords: ["7-zip", "rarlab", "voidtools"],
    },
    {
        key: "cloud",
        name: "云存储下载",
        description: "网盘、下载工具、文件传输",
        exactTerms: ["下载", "网盘", "云"],
        keywords: ["baidu netdisk", "qbittorrent", "thunder", "迅雷", "idm", "motrix", "transmission", "onedrive", "dropbox", "google drive"],
        publisherKeywords: ["baidu", "dropbox"],
    },
    {
        key: "ai",
        name: "AI 工具",
        description: "大语言模型、AI助手",
        exactTerms: ["ai", "chatgpt", "claude", "ollama"],
        keywords: ["ollama", "chatgpt", "claude", "gemini", "copilot", "midjourney", "stable diffusion"],
        publisherKeywords: ["openai", "anthropic", "ollama"],
    },
    {
        key: "component",
        name: "系统组件",
        description: "运行库、SDK、后台服务",
        exactTerms: ["runtime", "redistributable", "sdk"],
        keywords: ["runtime", "redistributable", "sdk", "driver", "update helper", "vc_redist", "directx", ".net framework"],
        pathKeywords: ["redistributable", "runtime", "driver", "sdk"],
    },
    {
        key: "other",
        name: "其他",
        description: "未分类软件",
    },
];

export const CATEGORY_BY_KEY = new Map<string, CategoryRule>(
    CATEGORY_RULES.map(rule => [rule.key, rule])
);

export const FALLBACK_CATEGORY = CATEGORY_BY_KEY.get("other")!;
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/classification/rules.ts
git commit -m "feat: add CATEGORY_RULES with publisherKeywords"
```

### Task A5: 创建 Heuristics

**Files:**
- Create: `src/utils/classification/heuristics.ts`

- [ ] **Step 1: 创建 heuristics.ts**

```typescript
import type { PathHeuristic } from "./types";

export const PATH_HEURISTICS: PathHeuristic[] = [
    { pathToken: "games", categoryKey: "gaming", reason: "安装路径含 games 目录" },
    { pathToken: "steam", categoryKey: "gaming", reason: "安装路径含 steam 目录" },
    { pathToken: "utilities", categoryKey: "system", reason: "安装路径含 utilities 目录" },
    { pathToken: "security", categoryKey: "system", reason: "安装路径含 security 目录" },
    { pathToken: "adobe", categoryKey: "design", reason: "安装路径含 adobe 目录" },
    { pathToken: "jetbrains", categoryKey: "development", reason: "安装路径含 jetbrains 目录" },
    { pathToken: "tencent", categoryKey: "office", reason: "安装路径含 tencent 目录" },
    { pathToken: "python3", categoryKey: "development", reason: "安装路径含 python3 目录" },
    { pathToken: "nodejs", categoryKey: "development", reason: "安装路径含 nodejs 目录" },
    { pathToken: "docker", categoryKey: "development", reason: "安装路径含 docker 目录" },
    { pathToken: "epic games", categoryKey: "gaming", reason: "安装路径含 epic games 目录" },
    { pathToken: "microsoft office", categoryKey: "office", reason: "安装路径含 microsoft office 目录" },
];
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/classification/heuristics.ts
git commit -m "feat: add PATH_HEURISTICS for weak structural signals"
```

### Task A6: 创建 Pipeline

**Files:**
- Create: `src/utils/classification/pipeline.ts`

- [ ] **Step 1: 创建 pipeline.ts**

实现完整的 3 层决策 Pipeline：Layer 0 组件检测 → Override → Layer 1 硬匹配 → Layer 2 强信号 → Heuristics → Layer 3 软评分 → 兜底。

核心函数：
- `classifyInstalledApp(app: NormalizedApp): ClassificationResult`
- `layer0_ComponentCheck(app): ClassificationResult | null`
- `layer1_HardMatch(app): CategoryKey | null`
- `layer2_StrongSignals(app): Candidate[]`
- `resolveLayer2(candidates): CategoryKey | null` (含 Δ阈值 0.15)
- `layer3_SoftScoring(app, tiedCandidates?): { categoryKey, reason }`

Override 查找暂时返回 null（Phase B 实现）。

- [ ] **Step 2: Commit**

```bash
git add src/utils/classification/pipeline.ts
git commit -m "feat: add 3-layer classification pipeline"
```

### Task A7: 创建统一导出

**Files:**
- Create: `src/utils/classification/index.ts`

- [ ] **Step 1: 创建 index.ts**

```typescript
export type { NormalizedApp, CategoryRule, Candidate, ClassificationResult, PathHeuristic, CategoryOverride, CategoryKey } from "./types";
export { normalizeApp, normalizePublisher, normalizeTextForMatching, matchPublisher, cleanToken } from "./normalizer";
export { EXE_MAP, lookupExeMap } from "./exe-map";
export { CATEGORY_RULES, CATEGORY_BY_KEY, FALLBACK_CATEGORY } from "./rules";
export { PATH_HEURISTICS } from "./heuristics";
export { classifyInstalledApp } from "./pipeline";
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/classification/index.ts
git commit -m "feat: add classification module index"
```

### Task A8: Rust 后端添加 publisher 字段

**Files:**
- Modify: `src-tauri/src/commands/installed_apps.rs`

- [ ] **Step 1: 在 InstalledAppEntry 添加 publisher 字段**

在 struct 定义中添加 `pub publisher: Option<String>`

- [ ] **Step 2: 在注册表扫描中读取 Publisher**

在 `build_candidate_from_registry` 中添加 `let publisher = key.get_value::<String, _>("Publisher").ok();`

- [ ] **Step 3: 在 StartMenu 扫描中传递 publisher**

- [ ] **Step 4: 运行 cargo check 验证**

```bash
cd src-tauri && cargo check
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/installed_apps.rs
git commit -m "feat: add publisher field to InstalledAppEntry"
```

### Task A9: 重构 ai-organizer.ts 使用新 Pipeline

**Files:**
- Modify: `src/utils/ai-organizer.ts`

- [ ] **Step 1: 替换旧加权模型为新 Pipeline**

将 `classifyInstalledAppWithRules` 替换为调用 `classifyInstalledApp` from pipeline。
保留所有现有导出接口不变。

- [ ] **Step 2: 运行 typecheck 验证**

```bash
npx vue-tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/utils/ai-organizer.ts
git commit -m "refactor: ai-organizer uses new classification pipeline"
```

### Task A10: 创建 Pipeline 测试

**Files:**
- Create: `src/utils/classification/__tests__/pipeline.test.ts`

- [ ] **Step 1: 编写测试用例**

覆盖：
- Layer 1: EXE_MAP 硬匹配 (chrome.exe → browser)
- Layer 1: exactTerms 匹配
- Layer 2: Publisher 匹配 (JetBrains → development)
- Layer 2: Δ阈值裁决 (0.9 vs 0.7 → 选 0.9)
- Layer 2: 多候选 → 下一层
- Heuristics: pathToken 匹配
- Layer 3: 去重计分
- 兜底: "other"
- 组件检测: runtime/redistributable

- [ ] **Step 2: 运行测试**

```bash
npx vitest run src/utils/classification/__tests__/pipeline.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/utils/classification/__tests__/pipeline.test.ts
git commit -m "test: add classification pipeline tests"
```

---

## Phase B: 行为反馈

### Task B1: 创建 Override Store

**Files:**
- Create: `src/stores/overrideStore.ts`

- [ ] **Step 1: 创建 overrideStore.ts**

实现：
- `categoryOverrides` ref + persist
- `addOverride(override)` / `removeOverride(key)`
- `lookupOverride(app: NormalizedApp): CategoryOverride | null` (三层 key 查找)
- `getEffectiveConfidence(override): number` (衰减计算)
- `buildOverrideKeys(app: NormalizedApp): string[]` (三层 key 生成)
- `decayFactor`: user=1.0, ai=0.98

- [ ] **Step 2: 更新 pipeline.ts 的 Override 查找**

将 pipeline 中的 `lookupOverride` 改为调用 overrideStore

- [ ] **Step 3: Commit**

```bash
git add src/stores/overrideStore.ts src/utils/classification/pipeline.ts
git commit -m "feat: add overrideStore with 3-layer key + decay"
```

### Task B2: AIOrganizer 集成 Override

**Files:**
- Modify: `src/views/AIOrganizer.vue`

- [ ] **Step 1: 用户修正分类时写入 Override**

在 AIOrganizer 的分类修改操作中，调用 `addOverride({ source: "user", confidence: 1.0, decayFactor: 1.0 })`

- [ ] **Step 2: 显示分类置信度**

在 UI 中可选显示 confidence 值

- [ ] **Step 3: Commit**

```bash
git add src/views/AIOrganizer.vue
git commit -m "feat: integrate override into AIOrganizer"
```

### Task B3: searchToLaunch 信号

**Files:**
- Create: `src/composables/useSearchToLaunch.ts`
- Modify: `src/composables/useSearch.ts`
- Modify: `src/stores/statsStore.ts`

- [ ] **Step 1: 在 statsStore 添加 searchSessions**

```typescript
type SearchSession = {
    keyword: string;
    resultCount: number;
    launchedItemId: string | null;
    launchedAt: number | null;
};
const searchSessions = ref<SearchSession[]>([]);
```

- [ ] **Step 2: 创建 useSearchToLaunch composable**

记录搜索 → 启动转化率，用于搜索排序优化。

- [ ] **Step 3: 在 useSearch 中集成**

搜索时记录 SearchSession，启动时更新 launchedItemId。

- [ ] **Step 4: Commit**

```bash
git add src/composables/useSearchToLaunch.ts src/composables/useSearch.ts src/stores/statsStore.ts
git commit -m "feat: add searchToLaunch signal for search quality"
```

### Task B4: 降低时段推荐冷启动门槛

**Files:**
- Modify: `src/stores/statsStore.ts`

- [ ] **Step 1: 替换固定阈值为渐进式**

将 `MIN_TIME_SLOT_RECOMMENDATION_*` 常量替换为 `getTimeBasedThreshold(totalLaunches)` 函数。

- [ ] **Step 2: Commit**

```bash
git add src/stores/statsStore.ts
git commit -m "feat: progressive time-based recommendation thresholds"
```

### Task B5: launchDurations 简化版

**Files:**
- Create: `src/composables/useLaunchDuration.ts`
- Modify: `src/stores/statsStore.ts`

- [ ] **Step 1: 创建 useLaunchDuration**

记录启动时间，下次启动时计算上一个 app 的时长。区分 accidental (<3s) / brief / meaningful (>30s)。

- [ ] **Step 2: 在 launcherStore 的 recordItemUsage 中集成**

- [ ] **Step 3: Commit**

```bash
git add src/composables/useLaunchDuration.ts src/stores/statsStore.ts
git commit -m "feat: add simplified launchDuration tracking"
```

### Task B6: Context Trigger

**Files:**
- Create: `src/composables/useContextTrigger.ts`
- Modify: `src/composables/useHomePageState.ts`

- [ ] **Step 1: 创建 useContextTrigger**

从 launchEvents 中挖掘"启动 A 后 5 分钟内启动 B"的模式。

- [ ] **Step 2: 在 useHomePageState 中集成**

首页展示"刚打开了 X，你可能还需要 Y"。

- [ ] **Step 3: Commit**

```bash
git add src/composables/useContextTrigger.ts src/composables/useHomePageState.ts
git commit -m "feat: add context trigger recommendations"
```

---

## Phase C: AI 补位

### Task C1: AI 输入过滤 + Suspicion Signals

**Files:**
- Create: `src/utils/classification/ai-filter.ts`

- [ ] **Step 1: 创建 ai-filter.ts**

实现 `shouldSendToAI(result)` 和 `isSuspicious(result)`：
- confidence < 0.7 → true
- Publisher 与分类冲突 → true
- exeName 强语义不匹配 → true
- "other" 但有明显 token → true

- [ ] **Step 2: Commit**

```bash
git add src/utils/classification/ai-filter.ts
git commit -m "feat: add AI input filter with suspicion signals"
```

### Task C2: AI 缓存层

**Files:**
- Create: `src/utils/classification/ai-cache.ts`

- [ ] **Step 1: 创建 ai-cache.ts**

```typescript
const AI_CACHE = new Map<string, string>();

function getAICacheKey(app: NormalizedApp): string {
    return simpleHash(app.nameTokens.join(" ") + "|" + (app.publisherToken || ""));
}

function getCachedAICategory(app: NormalizedApp): string | null
function setCachedAICategory(app: NormalizedApp, categoryKey: string): void
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/classification/ai-cache.ts
git commit -m "feat: add AI result cache layer"
```

### Task C3: 重构 AI 精修流程

**Files:**
- Modify: `src/utils/ai-organizer-ai.ts`
- Modify: `src/views/AIOrganizer.vue`

- [ ] **Step 1: 修改 AI 输入格式**

添加 publisher、exeName、currentConfidence、ruleMatchedLayers 到 AI 输入。

- [ ] **Step 2: 集成 AI 过滤**

只发送 `shouldSendToAI(result) === true` 的项给 AI。

- [ ] **Step 3: 集成 AI 缓存**

发送前检查缓存，命中则跳过。

- [ ] **Step 4: AI 结果写入 Override（而非直接修改分类）**

- [ ] **Step 5: 添加 AI 反馈记录**

- [ ] **Step 6: Commit**

```bash
git add src/utils/ai-organizer-ai.ts src/views/AIOrganizer.vue
git commit -m "refactor: AI only handles uncertain+suspicious items, writes to Override"
```

### Task C4: 新分类审批 + 收敛机制

**Files:**
- Modify: `src/views/AIOrganizer.vue`
- Modify: `src/utils/classification/rules.ts`

- [ ] **Step 1: 实现分类收敛策略**

- MAX_CUSTOM_CATEGORIES = 12
- isTooSimilar (levenshtein < 3)
- 冷却期 7 天
- 弱分类自动回收 (itemCount < 3 && age > 14 days)

- [ ] **Step 2: UI 中添加新分类审批界面**

- [ ] **Step 3: Commit**

```bash
git add src/views/AIOrganizer.vue src/utils/classification/rules.ts
git commit -m "feat: add category convergence and approval flow"
```

---

## Phase D: 规则自进化

### Task D1: 模式发现

**Files:**
- Create: `src/utils/classification/pattern-discovery.ts`

- [ ] **Step 1: 创建 pattern-discovery.ts**

从 AI override 中统计重复模式：
- Publisher 模式 (同一 publisher → 同一分类，出现 3+ 次)
- exeName 模式
- keyword 模式

过滤条件：confidence >= 0.7 且 evidence >= 3

- [ ] **Step 2: Commit**

```bash
git add src/utils/classification/pattern-discovery.ts
git commit -m "feat: add pattern discovery from AI overrides"
```

### Task D2: 规则提案 + 持久化

**Files:**
- Create: `src/utils/classification/rule-proposal.ts`

- [ ] **Step 1: 创建 rule-proposal.ts**

- ProposedRule 类型
- RuleProposal 类型 (pending/approved/rejected)
- customRules ref + persist
- applyApprovedRule(proposal) 写入 CATEGORY_RULES / EXE_MAP

- [ ] **Step 2: Commit**

```bash
git add src/utils/classification/rule-proposal.ts
git commit -m "feat: add rule proposal and persistence"
```

### Task D3: 规则提案 UI

**Files:**
- Modify: `src/views/AIOrganizer.vue` 或新建设置页面

- [ ] **Step 1: 添加规则提案展示**

"发现模式：发行商 'JetBrains' 的软件通常属于「开发」分类（5项），是否添加为规则？"

- [ ] **Step 2: Commit**

```bash
git add src/views/AIOrganizer.vue
git commit -m "feat: add rule proposal UI in AIOrganizer"
```

---

## 任务依赖关系

```
A1 → A2 → A3 → A4 → A5 → A6 → A7 → A8 → A9 → A10
                                              ↓
                                          B1 → B2
                                              ↓
                                          B3 (独立)
                                          B4 (独立)
                                          B5 (独立)
                                          B6 (依赖 B5)
                                              ↓
                                          C1 → C2 → C3 → C4
                                                        ↓
                                                    D1 → D2 → D3
```

**可并行的任务**：B3/B4/B5 之间无依赖，可同时执行。

---

## 实施顺序建议

| 批次 | 任务 | 预计复杂度 |
|------|------|-----------|
| 1 | A1-A7 (分类模块骨架) | 中 |
| 2 | A8 (Rust publisher) | 低 |
| 3 | A9-A10 (集成 + 测试) | 中 |
| 4 | B1-B2 (Override Store + 集成) | 中 |
| 5 | B3-B6 (行为反馈，可并行) | 中 |
| 6 | C1-C2 (AI 过滤 + 缓存) | 低 |
| 7 | C3-C4 (AI 重构 + 收敛) | 高 |
| 8 | D1-D3 (规则自进化) | 中 |
