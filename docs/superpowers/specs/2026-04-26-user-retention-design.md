# 用户留存优化设计：分层决策规则引擎 + 个性化留存

> 日期：2026-04-26
> 状态：Phase A + Phase B 设计已确认，待实施

---

## 核心目标

1. AIOrganizer 规则分类准确率从 ~70% 提升到 ~92-95%
2. 首次体验用户无需 AI 即可获得高质量分类
3. 通过数据驱动的个性化提升长期留存

---

## Phase A: 分层决策规则引擎

### 架构：从加权模型 → 分层决策 Pipeline

```
输入: NormalizedApp
  ↓
Layer 0: 组件检测 (short-circuit)
  ↓ 未命中
Override 层 (用户修正记录, O(1) 查找)
  ↓ 未命中
Layer 1: 硬匹配 (short-circuit, confidence=1.0)
  ↓ 未命中
Layer 2: 强信号 (候选集 + 置信度, Δ阈值裁决)
  ↓ 唯一候选 → 返回 | 多候选 → Heuristics
Heuristics: 弱结构信号 (< 20条)
  ↓ 未命中
Layer 3: 软评分 (去重计分, tie-break)
  ↓
兜底: "其他" / "系统组件"
```

### 1. Normalization 层

所有输入先标准化，规则只匹配标准化后的 token：

```typescript
type NormalizedApp = {
    name: string;
    path: string;
    icon_base64: string | null;
    source: string;
    publisher: string | null;       // 新增：Rust 后端传入
    nameTokens: string[];           // "PyCharm 2024.1" → ["pycharm"]
    pathTokens: string[];           // "C:\Program Files\JetBrains\PyCharm" → ["jetbrains", "pycharm"]
    publisherToken: string | null;  // "Microsoft Corporation" → "microsoft"
    exeName: string;                // "pycharm64.exe" → "pycharm64"
};
```

**Publisher normalize**：

```typescript
function normalizePublisher(raw: string): string {
    return raw
        .normalize("NFKC")
        .toLowerCase()
        .replace(/\b(inc|llc|ltd|gmbh|co|corp|corporation|limited|s\.?r\.?o|pvt|ab|sa|nv|bv|ag|kg)\b/g, "")
        .replace(/[.,]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}
```

示例：
| 原始 | 标准化 |
|------|--------|
| "Microsoft Corporation" | "microsoft" |
| "JetBrains s.r.o." | "jetbrains" |
| "Adobe Systems Inc." | "adobe systems" |
| "Valve Corporation" | "valve" |

**Token 清洗（去版本号）**：

```typescript
function cleanToken(token: string): string {
    return token
        .replace(/\d+(\.\d+)*/g, "")
        .replace(/(x64|x86|win64|win32)/gi, "")
        .trim();
}
```

否则 `pycharm64` → 匹配失败。清洗后 → `pycharm`。

### 2. Layer 0: 组件检测

```typescript
// 现有 NON_LAUNCHABLE_TERMS 保留
// 新增规则：
// - 没有 exe / 没有 icon → component
// - path 包含: redistributable, runtime, driver, sdk, update helper
```

### 3. Layer 1: 硬匹配 (short-circuit, confidence=1.0)

**EXE_MAP**: O(1) 查找，不走规则系统

```typescript
const EXE_MAP: Record<string, CategoryKey> = {
    "chrome.exe": "browser",
    "firefox.exe": "browser",
    "msedge.exe": "browser",
    "brave.exe": "browser",
    "opera.exe": "browser",
    "vivaldi.exe": "browser",
    "wechat.exe": "office",
    "dingtalk.exe": "office",
    "feishu.exe": "office",
    "steam.exe": "gaming",
    "epicgameslauncher.exe": "gaming",
    "wegame.exe": "gaming",
    "discord.exe": "office",
    "telegram.exe": "office",
    "obs64.exe": "design",
    "potplayer.exe": "media",
    "ollama.exe": "ai",
    // ... 持续扩展
};
```

**exactTerms**: 保留现有逻辑，直接 short-circuit

```typescript
function layer1_HardMatch(app: NormalizedApp): CategoryKey | null {
    // 1. exe 名精确匹配 (O(1))
    const exeCategory = EXE_MAP[app.exeName.toLowerCase()];
    if (exeCategory) return exeCategory;

    // 2. exactTerms 精确匹配
    for (const rule of CATEGORY_RULES) {
        if (rule.exactTerms?.some(term =>
            app.nameTokens.includes(normalizeTextForMatching(term))
        )) {
            return rule.key;
        }
    }

    return null;
}
```

### 4. Layer 2: 强信号 (候选集 + 置信度)

**Publisher 匹配用 token-based，不用 substring**：

```typescript
function matchPublisher(publisher: string, keyword: string): boolean {
    const pubTokens = publisher.split(" ");
    const kwTokens = keyword.split(" ");
    return kwTokens.every(t => pubTokens.includes(t));
}
```

避免 "microsoft visual studio code team" 误匹配 "microsoft visual studio"。

**Layer 2 实现**：

```typescript
type Candidate = {
    categoryKey: CategoryKey;
    confidence: number;
    reason: string;
};

function layer2_StrongSignals(app: NormalizedApp): Candidate[] {
    const candidates: Candidate[] = [];

    // 1. Publisher 匹配（confidence=0.9）
    if (app.publisherToken) {
        for (const rule of CATEGORY_RULES) {
            if (rule.publisherKeywords?.some(kw =>
                matchPublisher(app.publisherToken!, normalizePublisher(kw))
            )) {
                candidates.push({
                    categoryKey: rule.key,
                    confidence: 0.9,
                    reason: `发行商匹配：${app.publisherToken}`,
                });
            }
        }
    }

    // 2. Path 结构化匹配（confidence=0.7）
    for (const rule of CATEGORY_RULES) {
        if (rule.pathKeywords?.some(kw =>
            app.pathTokens.includes(normalizeTextForMatching(kw))
        )) {
            if (!candidates.some(c => c.categoryKey === rule.key)) {
                candidates.push({
                    categoryKey: rule.key,
                    confidence: 0.7,
                    reason: `安装路径匹配`,
                });
            }
        }
    }

    return candidates;
}
```

**Layer 2 决策：Δ置信度阈值**

```typescript
const DELTA_THRESHOLD = 0.15;

function resolveLayer2(candidates: Candidate[]): CategoryKey | null {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0].categoryKey;

    candidates.sort((a, b) => b.confidence - a.confidence);

    // 不是"是否更大"，而是"是否明显更大"
    if (candidates[0].confidence - candidates[1].confidence >= DELTA_THRESHOLD) {
        return candidates[0].categoryKey;
    }

    // 置信度差距不够 → 继续下一层
    return null;
}
```

### 5. Heuristics (弱结构信号, < 20条)

放在 Layer 2 之后、Layer 3 之前（比关键词更可靠）：

```typescript
type PathHeuristic = {
    pathToken: string;        // 预编译 token，不用 glob
    categoryKey: CategoryKey;
    reason: string;
};

const PATH_HEURISTICS: PathHeuristic[] = [
    { pathToken: "games", categoryKey: "gaming", reason: "安装路径含 games 目录" },
    { pathToken: "steam", categoryKey: "gaming", reason: "安装路径含 steam 目录" },
    { pathToken: "utilities", categoryKey: "system", reason: "安装路径含 utilities 目录" },
    { pathToken: "security", categoryKey: "system", reason: "安装路径含 security 目录" },
    { pathToken: "adobe", categoryKey: "design", reason: "安装路径含 adobe 目录" },
    { pathToken: "jetbrains", categoryKey: "development", reason: "安装路径含 jetbrains 目录" },
    { pathToken: "tencent", categoryKey: "office", reason: "安装路径含 tencent 目录" },
    // ... 总数 < 20
];
```

### 6. Layer 3: 软评分 (去重计分, tie-break)

**信号去重**：避免同一信号被 nameTokens 和 pathTokens 重复加分。

```typescript
function layer3_SoftScoring(
    app: NormalizedApp,
    tiedCandidates?: Candidate[]
): { categoryKey: CategoryKey; reason: string } {
    let bestRule: CategoryRule = FALLBACK_CATEGORY;
    let bestScore = 0;
    let bestReason = "未命中特征词，先归到其他";

    const candidateKeys = tiedCandidates?.map(c => c.categoryKey);
    const rules = candidateKeys
        ? CATEGORY_RULES.filter(r => candidateKeys.includes(r.key))
        : CATEGORY_RULES;

    for (const rule of rules) {
        const matchedSignals = new Set<string>();

        const matchedKeywords = (rule.keywords || []).filter(kw => {
            const normalized = normalizeTextForMatching(kw);
            if (app.nameTokens.includes(normalized)) {
                matchedSignals.add(normalized);
                return true;
            }
            return false;
        });

        (rule.pathKeywords || []).filter(kw => {
            const normalized = normalizeTextForMatching(kw);
            if (app.pathTokens.includes(normalized)) {
                matchedSignals.add(normalized);
                return true;
            }
            return false;
        });

        const score = matchedSignals.size * 24;

        if (score > bestScore) {
            bestRule = rule;
            bestScore = score;
            bestReason = matchedKeywords.length > 0
                ? `关键词匹配：${matchedKeywords.slice(0, 2).join(" / ")}`
                : bestReason;
        }
    }

    return { categoryKey: bestRule.key, reason: bestReason };
}
```

### 7. 完整 Pipeline

```typescript
function classifyInstalledApp(app: NormalizedApp): {
    rule: CategoryRule;
    reason: string;
    confidence: number;
} {
    // Layer 0: 组件检测
    if (isLikelyNonLaunchableItem(app)) {
        return {
            rule: CATEGORY_BY_KEY.get("component") || FALLBACK_CATEGORY,
            reason: "命中组件特征：运行库/后台工具",
            confidence: 0.95,
        };
    }

    // Override 层: 用户修正记录
    const override = lookupOverride(app);
    if (override) {
        return {
            rule: CATEGORY_BY_KEY.get(override) || FALLBACK_CATEGORY,
            reason: "用户手动修正",
            confidence: 1.0,
        };
    }

    // Layer 1: 硬匹配
    const hardMatch = layer1_HardMatch(app);
    if (hardMatch) {
        return {
            rule: CATEGORY_BY_KEY.get(hardMatch) || FALLBACK_CATEGORY,
            reason: buildHardMatchReason(app),
            confidence: 1.0,
        };
    }

    // Layer 2: 强信号
    const candidates = layer2_StrongSignals(app);
    const resolved = resolveLayer2(candidates);
    if (resolved) {
        const best = candidates.find(c => c.categoryKey === resolved)!;
        return {
            rule: CATEGORY_BY_KEY.get(resolved) || FALLBACK_CATEGORY,
            reason: best.reason,
            confidence: best.confidence,
        };
    }

    // Heuristics: 弱结构信号
    for (const heuristic of PATH_HEURISTICS) {
        if (app.pathTokens.includes(heuristic.pathToken)) {
            return {
                rule: CATEGORY_BY_KEY.get(heuristic.categoryKey) || FALLBACK_CATEGORY,
                reason: heuristic.reason,
                confidence: 0.3,
            };
        }
    }

    // Layer 3: 软评分
    const softResult = layer3_SoftScoring(
        app,
        candidates.length > 0 ? candidates : undefined
    );
    if (softResult.categoryKey !== "other") {
        return {
            rule: CATEGORY_BY_KEY.get(softResult.categoryKey) || FALLBACK_CATEGORY,
            reason: softResult.reason,
            confidence: 0.5,
        };
    }

    // 最终兜底
    return {
        rule: FALLBACK_CATEGORY,
        reason: "未命中特征词，先归到其他",
        confidence: 0,
    };
}
```

### 8. CategoryRule 类型更新

```typescript
type CategoryRule = {
    key: CategoryKey;
    name: string;
    description: string;
    exactTerms?: string[];          // 保留
    keywords?: string[];            // 保留
    pathKeywords?: string[];        // 保留
    publisherKeywords?: string[];   // 新增：Publisher 匹配
    // 废弃: bias (分层决策不需要)
};
```

### 9. 测试框架（含置信度）

```typescript
type ClassificationTestCase = {
    name: string;
    path: string;
    publisher?: string;
    expected: CategoryKey;
    minConfidence: number;
};

const TEST_CASES: ClassificationTestCase[] = [
    { name: "Google Chrome", path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", publisher: "Google LLC", expected: "browser", minConfidence: 1.0 },
    { name: "微信", path: "C:\\Program Files\\Tencent\\WeChat\\WeChat.exe", publisher: "Tencent", expected: "office", minConfidence: 1.0 },
    { name: "Steam", path: "C:\\Program Files\\Steam\\steam.exe", publisher: "Valve Corporation", expected: "gaming", minConfidence: 0.9 },
    { name: "Adobe Photoshop", path: "C:\\Program Files\\Adobe\\Photoshop\\photoshop.exe", publisher: "Adobe Systems", expected: "design", minConfidence: 0.9 },
    { name: "PyCharm", path: "C:\\Program Files\\JetBrains\\PyCharm\\bin\\pycharm64.exe", publisher: "JetBrains s.r.o.", expected: "development", minConfidence: 0.9 },
    // ... 50-100 个测试用例
];
```

### 10. 废弃项

| 原设计 | 处理 | 原因 |
|--------|------|------|
| 权重打分表 | ❌ 废弃 | 改为分层决策，不调权重 |
| pathPatterns (glob) | ❌ 废弃 | 改为 pathTokens 预编译 |
| executableNames 在规则内 | ❌ 废弃 | 独立为 EXE_MAP (O(1)) |
| bias 字段 | ❌ 废弃 | 分层决策不需要偏置 |

### 11. 影响范围

| 文件 | 改动 |
|------|------|
| `src-tauri/src/commands/installed_apps.rs` | 添加 publisher 字段 |
| `src/utils/ai-organizer.ts` | **重构**：Normalization + 3层 Pipeline + EXE_MAP + Heuristics + Override |
| `src/utils/__tests__/ai-organizer.test.ts` | 新增：含置信度的测试框架 |
| `src/views/AIOrganizer.vue` | 适配 confidence 字段（可选展示） |

---

## Phase B: 个性化留存

### 模块 B1: Override 系统（与规则引擎的融合点）

**Override 层在规则引擎之前拦截**：

```
输入 → Override 层 → Phase A Pipeline → 输出
```

**数据结构**：

```typescript
type CategoryOverride = {
    id: string;
    matchKey: string;          // 标识一个 app 的唯一键
    categoryKey: CategoryKey;  // 用户指定的分类
    createdAt: number;
    source: "user" | "ai";     // 来源：手动修正 or AI 建议
};
```

**matchKey 生成规则**：

```typescript
function buildOverrideMatchKey(app: NormalizedApp): string {
    if (app.exeName && app.exeName !== "") {
        return `exe:${app.exeName.toLowerCase()}`;
    }
    const pathSignature = app.pathTokens.slice(0, 3).join("/");
    return `name:${app.nameTokens.join(" ")}@${pathSignature}`;
}
```

为什么用 matchKey 而不是 appId：
- appId 是运行时生成的，不同机器不同
- matchKey 基于软件本身特征，可跨设备、可导出
- 同一软件重新扫描后，override 仍然有效

**Override 查找**：

```typescript
const EXE_OVERRIDE_MAP = new Map<string, CategoryOverride>();
const NAME_OVERRIDE_MAP = new Map<string, CategoryOverride>();

function lookupOverride(app: NormalizedApp): CategoryKey | null {
    const exeKey = `exe:${app.exeName.toLowerCase()}`;
    const exeOverride = EXE_OVERRIDE_MAP.get(exeKey);
    if (exeOverride) return exeOverride.categoryKey;

    const nameKey = buildOverrideMatchKey(app);
    const nameOverride = NAME_OVERRIDE_MAP.get(nameKey);
    if (nameOverride) return nameOverride.categoryKey;

    return null;
}
```

**Override 持久化**：

```typescript
const categoryOverrides = ref<CategoryOverride[]>([]);
// persist: createVersionedPersistConfig("overrides", ["categoryOverrides"])
```

**演化路径**（长期，非 Phase B 范围）：
- 同一 matchKey 的 override 被多次确认 → 可提升为规则

### 模块 B2: 行为建模

**已有信号**（statsStore）：

| 信号 | 可靠性 | 说明 |
|------|--------|------|
| launchEvents | 高 | 时间戳精确，反映真实行为 |
| recentUsedItems | 高 | 最近使用，时效性好 |
| searchHistory | 中 | 搜索意图，但噪声多 |
| timeBasedRecommendations | 中 | 时段模式，但冷启动慢 |
| categoryUsageDistribution | 中 | 分类偏好，受初始分类影响 |

**需新增的信号**：

| 信号 | 可靠性 | 说明 |
|------|--------|------|
| launchDurations | 高 | 启动后停留时长（区分"打开"和"使用"） |
| categoryCorrelations | 中 | 同一时段经常一起使用的分类 |
| searchToLaunch | 高 | 搜索后是否启动（搜索质量信号） |

**B2.1: launchDurations**

```typescript
type LaunchSession = {
    categoryId: string;
    itemId: string;
    startedAt: number;
    durationMs: number | null;
};

const launchSessions = ref<LaunchSession[]>([]);
```

简化版实现：
- 记录启动时间
- 下次启动任何 app 时，计算上一个 app 的"至少使用了 X 秒"
- 不需要精确，只需区分"点开就关"和"真正使用"

**B2.2: searchToLaunch**

```typescript
type SearchSession = {
    keyword: string;
    resultCount: number;
    launchedItemId: string | null;
    launchedAt: number | null;
};
```

价值：
- 搜索了但没启动 → 搜索结果不满足需求
- 搜索后立即启动 → 搜索精准
- 可优化搜索排序

### 模块 B3: 智能首页

**B3.1: 降低时段推荐冷启动门槛**

当前参数过于严格，改为渐进式：

```typescript
function getTimeBasedThreshold(totalLaunches: number) {
    if (totalLaunches < 3) return { minSlotLaunches: 2, minSlotShare: 0.4 };
    if (totalLaunches < 10) return { minSlotLaunches: 3, minSlotShare: 0.3 };
    return { minSlotLaunches: 3, minSlotShare: 0.25 };
}
```

**B3.2: 工作流推荐（A → B 模式）**

```typescript
type WorkflowPattern = {
    triggerItemId: string;
    triggerCategoryId: string;
    nextItemId: string;
    nextCategoryId: string;
    frequency: number;
    avgDelayMs: number;
};

function discoverWorkflowPatterns(
    events: LaunchEventRecord[],
    maxDelayMs: number = 300000
): WorkflowPattern[] {
    // 按 usedAt 排序
    // 相邻两次启动在 5 分钟内 → 候选 workflow
    // 统计频率，过滤低频模式
}
```

**B3.3: 分类偏好权重**

```typescript
type CategoryPreference = {
    categoryId: string;
    weight: number;
};
// 基于使用频率 + 时段 + 最近性
// 高频分类的 app 在首页更靠前
```

### 数据结构设计（避免迁移地狱）

**原则**：
1. 所有新增数据都有版本号
2. 新增字段都有默认值
3. 不删除旧字段，只标记 deprecated

```typescript
const STATS_SCHEMA_VERSION = 2;

function migrateStatsV1toV2(v1: any): any {
    return {
        ...v1,
        launchSessions: [],
        searchSessions: [],
        categoryOverrides: [],
        _schemaVersion: 2,
    };
}
```

### Phase B 实施优先级

| 优先级 | 模块 | 理由 |
|--------|------|------|
| **P0** | B1: Override 系统 | 与 Phase A 融合点，必须先做 |
| **P1** | B3.1: 降低时段推荐门槛 | 最小改动，最大体验提升 |
| **P2** | B3.3: 分类偏好权重 | 利用现有数据，无需新信号 |
| **P3** | B2.1: launchDurations | 需要新信号，但价值高 |
| **P4** | B3.2: 工作流推荐 | 复杂度高，但差异化明显 |
| **P5** | B2.2: searchToLaunch | 优化搜索质量，长期价值 |

---

## Rust 后端改动

### installed_apps.rs: 添加 publisher 字段

```rust
pub struct InstalledAppEntry {
    pub name: String,
    pub path: String,
    pub icon_base64: Option<String>,
    pub source: String,
    pub publisher: Option<String>,  // 新增
}

// 注册表扫描时读取
fn build_candidate_from_registry(key: &RegKey) -> Option<CandidateApp> {
    // ...
    let publisher = key.get_value::<String, _>("Publisher").ok();
    // ...
}
```

---

## 关键设计决策记录

| 决策 | 选择 | 原因 |
|------|------|------|
| 分类模型 | 分层决策 > 加权打分 | 可解释、易 debug、可扩展 |
| Publisher 匹配 | token-based > substring | 避免误伤 |
| exe 匹配 | 独立 EXE_MAP > 规则内 | O(1)、更干净 |
| path 匹配 | 预编译 token > glob | 更快、更稳定 |
| Override | matchKey > appId | 可跨设备、可导出 |
| Heuristics 位置 | Layer 2.5 > Layer 3 之后 | 比关键词更可靠 |
| 去重计分 | Set<signal> > 重复计数 | 更接近信息量 |
| Δ阈值 | 0.15 > 简单比较 | 避免弱信号干扰强信号 |
