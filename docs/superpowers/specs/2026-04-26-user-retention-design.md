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

**数据结构（v2 — 三层 key 体系）**：

```typescript
type CategoryOverride = {
    key: string;               // 三层 key 之一
    categoryKey: CategoryKey;  // 用户指定的分类
    confidence: number;        // 0~1, 用户修正=1.0, AI建议=0.7
    source: "user" | "ai";     // 来源
    createdAt: number;
    hitCount: number;          // 被命中次数（用于演化）
};
```

**三层 key 体系**：

| key 类型 | 格式 | 特性 | 用途 |
|----------|------|------|------|
| exe+publisher | `exe+publisher:${exe}:${publisher}` | 高精度，适合传播 | 首选 |
| exe | `exe:${exe}` | 泛化，但可控 | 次选 |
| fingerprint | `fingerprint:${hash}` | 仅本机精确匹配 | 兜底 |

```typescript
function buildOverrideKeys(app: NormalizedApp): string[] {
    const keys: string[] = [];

    if (app.exeName) {
        keys.push(`exe:${app.exeName.toLowerCase()}`);

        if (app.publisherToken) {
            keys.push(`exe+publisher:${app.exeName.toLowerCase()}:${app.publisherToken}`);
        }
    }

    const fingerprint = simpleHash(
        app.nameTokens.join(" ") + "|" +
        app.pathTokens.slice(0, 3).join("/")
    );
    keys.push(`fingerprint:${fingerprint}`);

    return keys;
}
```

**查找顺序（关键）**：

```typescript
// exe+publisher → exe → fingerprint
function lookupOverride(app: NormalizedApp): CategoryOverride | null {
    const keys = buildOverrideKeys(app);
    for (const key of keys) {
        const override = OVERRIDE_MAP.get(key);
        if (override) return override;
    }
    return null;
}
```

**Override 保护机制（AI override 不得覆盖 Layer1）**：

```typescript
// 在 Pipeline 中
const override = lookupOverride(app);
if (override) {
    // AI 低置信度 override 不得覆盖硬匹配
    if (override.source === "ai" && override.confidence < 0.8) {
        const hardMatch = layer1_HardMatch(app);
        if (hardMatch) {
            // Layer1 优先，AI override 不生效
            return { rule: CATEGORY_BY_KEY.get(hardMatch)!, reason: "硬匹配", confidence: 1.0 };
        }
    }
    return {
        rule: CATEGORY_BY_KEY.get(override.categoryKey) || FALLBACK_CATEGORY,
        reason: override.source === "user" ? "用户手动修正" : "AI 建议修正",
        confidence: override.confidence,
    };
}
```

**Override 持久化**：

```typescript
const categoryOverrides = ref<CategoryOverride[]>([]);
// persist: createVersionedPersistConfig("overrides", ["categoryOverrides"])
```

**演化路径**（长期，非 Phase B 范围）：
- 同一 key 的 override.hitCount 达到阈值 → 可提升为规则
- AI override 被用户确认 → confidence 提升

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

| 信号 | 可靠性 | 说明 | 优先级 |
|------|--------|------|--------|
| searchToLaunch | 高 | 搜索后是否启动（搜索质量信号） | **P1** |
| launchDurations | 高 | 启动后停留时长（区分"打开"和"使用"） | P4 |
| ~~categoryCorrelations~~ | ~~中~~ | ~~同一时段经常一起使用的分类~~ | **暂不做** |

**B2.1: searchToLaunch（隐藏王牌，提前做）**

```typescript
type SearchSession = {
    keyword: string;
    resultCount: number;
    launchedItemId: string | null;
    launchedAt: number | null;
};
```

**核心指标：转化率**

```typescript
conversionRate = launches / searches
```

**搜索排序自动进化**：

```typescript
score = baseScore * (1 + conversionRate)
```

不需要 AI，搜索会根据用户行为自动变准。

**B2.2: launchDurations（简化版）**

```typescript
// 不需要 Rust 监听窗口焦点
// 简化版：记录启动时间，下次启动时计算上一个 app 的时长

let lastLaunchStart: number | null = null;
let lastLaunchRef: { categoryId: string; itemId: string } | null = null;

function onLaunch(categoryId: string, itemId: string) {
    const now = Date.now();

    if (lastLaunchStart && lastLaunchRef) {
        const durationMs = now - lastLaunchStart;
        recordLaunchDuration(lastLaunchRef.categoryId, lastLaunchRef.itemId, durationMs);
    }

    lastLaunchStart = now;
    lastLaunchRef = { categoryId, itemId };
}
```

**时长分类**：

```typescript
if (durationMs < 3000) → "accidental"  // 误触
if (durationMs >= 3000 && durationMs < 30000) → "brief"  // 短暂使用
if (durationMs >= 30000) → "meaningful"  // 真正使用
```

只需要区分"点开"vs"真正用"，不需要精确时长。

**B2.3: categoryCorrelations — 暂不做**

原因：
- 噪声极大
- 解释困难
- 用户感知弱
- 必须在数据量足够大时再做

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

**B3.2: Context Trigger（上下文触发，比 workflow 更直接）**

```typescript
type ContextTrigger = {
    triggerItemId: string;
    triggerCategoryId: string;
    recommendedItemIds: string[];
    frequency: number;
};

// 从 launchEvents 中挖掘
// 用户刚打开 VSCode → 推荐 Terminal, Chrome, Git GUI
function discoverContextTriggers(events: LaunchEventRecord[]): ContextTrigger[] {
    // 统计"启动 A 后 5 分钟内启动 B"的频率
    // 过滤低频模式
}
```

**Context Trigger vs Workflow**：

| 方案 | 特点 | 用户感知 |
|------|------|----------|
| workflow | 离线统计，批量推荐 | 弱 |
| context trigger | 实时响应，即时推荐 | **强** |

**先做 context trigger，再做 workflow。**

**B3.3: 分类偏好权重**

```typescript
type CategoryPreference = {
    categoryId: string;
    weight: number;
};
// 基于使用频率 + 时段 + 最近性
// 高频分类的 app 在首页更靠前
```

**B3.4: 工作流推荐（A → B 模式，最后做）**

```typescript
type WorkflowPattern = {
    triggerItemId: string;
    triggerCategoryId: string;
    nextItemId: string;
    nextCategoryId: string;
    frequency: number;
    avgDelayMs: number;
};
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
        searchSessions: [],
        categoryOverrides: [],
        _schemaVersion: 2,
    };
}
```

### Phase B 实施优先级（修订版）

| 优先级 | 模块 | 理由 |
|--------|------|------|
| **P0** | B1: Override 系统（三层 key + confidence + 保护机制） | 与 Phase A 融合点，必须先做 |
| **P1** | B2.1: searchToLaunch | 性价比极高，搜索自动进化 |
| **P2** | B3.1: 降低时段推荐门槛 | 最小改动，最大体验提升 |
| **P3** | B3.3: 分类偏好权重 | 利用现有数据，无需新信号 |
| **P4** | B2.2: launchDurations（简化版） | 区分"点开"vs"真正用" |
| **P5** | B3.2: Context Trigger | 实时响应，强感知 |
| **P6** | B3.4: 工作流推荐 | 复杂度高，最后做 |

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
| Override key | 三层 key 体系 > 单一 matchKey | 防止过度泛化误伤 |
| Override 保护 | AI 低置信度不得覆盖 Layer1 | 防止 AI 灾难性误判 |
| Heuristics 位置 | Layer 2.5 > Layer 3 之后 | 比关键词更可靠 |
| 去重计分 | Set<signal> > 重复计数 | 更接近信息量 |
| Δ阈值 | 0.15 > 简单比较 | 避免弱信号干扰强信号 |
| searchToLaunch | P1 提前做 | 性价比极高，搜索自动进化 |
| categoryCorrelations | 暂不做 | 噪声大、解释难、感知弱 |
| Context Trigger | 先于 Workflow | 实时响应，用户感知更强 |
| launchDurations | 简化版（不监听焦点） | ROI 不对，区分"点开"vs"用"即可 |
| AI 输入过滤 | confidence < 0.7 OR suspicious | 不只低置信，还处理高置信但矛盾 |
| AI Override | 衰减机制 decayFactor=0.98/天 | AI 错误不永久污染 |
| AI 新分类 | 4层收敛（上限+去重+冷却+回收） | 防止分类爆炸 |
| AI 角色 | 规则生成器 > 分类工具 | 用 AI 训练规则引擎，成本趋近零 |
| Suspicion Signals | 3种（Publisher冲突/exe冲突/other+强token） | 高置信纠错 |

---

## Phase C: AI 介入点设计

> 核心原则：AI 只补位，不主导。

### C1: AI 输入过滤 — 不只是"低置信"，还要处理"高置信但矛盾"

**基础过滤**：

```typescript
function shouldSendToAI(result: ClassificationResult): boolean {
    if (result.confidence < 0.7) return true;

    // 新增：高置信但可疑
    if (isSuspicious(result)) return true;

    return false;
}
```

**Suspicion Signals（可疑信号，非常关键）**：

| 信号 | 检测逻辑 | 示例 |
|------|----------|------|
| Publisher 与分类冲突 | publisherToken 已知属于某分类，但判定结果不同 | publisher="jetbrains" → 判为 media |
| exeName 强语义不匹配 | EXE_MAP 中有该 exe 但分类不同 | code.exe → 判为 system |
| "other" 但有明显 token | nameTokens 含 studio/editor/manager 等 | "Android Studio" → other |

```typescript
function isSuspicious(result: ClassificationResult): boolean {
    // 1. Publisher 与分类冲突
    if (result.app.publisherToken) {
        for (const rule of CATEGORY_RULES) {
            if (rule.publisherKeywords?.some(kw =>
                matchPublisher(result.app.publisherToken!, normalizePublisher(kw))
            ) && rule.key !== result.rule.key) {
                return true;
            }
        }
    }

    // 2. exeName 强语义不匹配
    const exeCategory = EXE_MAP[result.app.exeName.toLowerCase()];
    if (exeCategory && exeCategory !== result.rule.key) {
        return true;
    }

    // 3. "other" 但有明显 token
    if (result.rule.key === "other") {
        const strongTokens = ["studio", "editor", "manager", "browser", "player"];
        if (result.app.nameTokens.some(t => strongTokens.includes(t))) {
            return true;
        }
    }

    return false;
}
```

**本质**：AI 不只处理"低置信"，还处理"高置信但矛盾"。

### C2: AI Prompt 优化 — 给 AI 更好的上下文

```typescript
type AIRefineInput = {
    id: string;
    name: string;
    path: string;
    publisher: string | null;
    exeName: string;
    currentCategoryKey: string;
    currentReason: string;
    currentConfidence: number;
    ruleMatchedLayers: string[];
};
```

Prompt 中加入：
```
这个软件的规则分类置信度为 {confidence}，命中了 {layers}。
请重点判断：规则分类是否正确？如果不正确，应该归入哪个分类？
```

### C3: AI 结果校验层

```typescript
type AIAssignmentWithValidation = {
    id: string;
    categoryKey: string;
    reason: string;
    isValid: boolean;
    validationError?: string;
};

function validateAIAssignment(
    assignment: AIOrganizerAssignment,
    existingCategories: Map<string, CategoryRule>,
    inputItems: Map<string, NormalizedApp>
): AIAssignmentWithValidation {
    // 1. id 必须在输入中存在
    if (!inputItems.has(assignment.id)) {
        return { ...assignment, isValid: false, validationError: "AI 返回了不存在的 id" };
    }

    // 2. categoryKey 必须是已有分类或合法新分类
    if (existingCategories.has(assignment.category_key)) {
        return { ...assignment, isValid: true };
    }

    // 3. 新分类必须有 name 和 description
    if (!assignment.category_name || !assignment.category_description) {
        return { ...assignment, isValid: false, validationError: "新分类缺少名称或描述" };
    }

    // 4. 新分类不能和已有分类过于相似
    const similarKey = findSimilarCategoryKey(assignment.category_key, existingCategories);
    if (similarKey) {
        return { ...assignment, isValid: false, validationError: `新分类与已有分类 ${similarKey} 过于相似` };
    }

    return { ...assignment, isValid: true };
}
```

### C4: AI 结果写入 Override（含衰减机制）

**Override 衰减（关键新增）**：

```typescript
type CategoryOverride = {
    key: string;
    categoryKey: CategoryKey;
    confidence: number;
    source: "user" | "ai";
    createdAt: number;
    lastUsedAt: number;      // 新增：最后使用时间
    hitCount: number;
    decayFactor: number;     // 新增：衰减因子
};

function getEffectiveConfidence(override: CategoryOverride): number {
    const now = Date.now();
    const days = (now - override.lastUsedAt) / (24 * 60 * 60 * 1000);
    return override.confidence * Math.pow(override.decayFactor, days);
}
```

**推荐参数**：

| source | 初始 confidence | decayFactor | 30天后 |
|--------|----------------|-------------|--------|
| user | 1.0 | 1.0（永不衰减） | 1.0 |
| ai | 0.7 | 0.98/天 | ~0.55 |

**衰减的好处**：
- AI 错误不会永久污染
- 用户长期不用的软件自动"降权"
- 衰减后 effective confidence < 0.5 → Override 失效，回归规则引擎判定

**AI 结果写入 Override**：

```typescript
function applyAIResults(
    assignments: AIAssignmentWithValidation[],
    items: Map<string, NormalizedApp>
): void {
    for (const assignment of assignments) {
        if (!assignment.isValid) continue;
        const app = items.get(assignment.id);
        if (!app) continue;

        addOverride({
            key: buildOverrideKeys(app)[0],
            categoryKey: assignment.categoryKey,
            confidence: 0.7,
            source: "ai",
            createdAt: Date.now(),
            lastUsedAt: Date.now(),
            hitCount: 0,
            decayFactor: 0.98,
        });
    }
}
```

### C5: AI 新分类审批 + 收敛机制

**分类收敛策略（4 层防护）**：

**1. 分类数量上限（硬限制）**：

```typescript
const MAX_CUSTOM_CATEGORIES = 12;
```

超过后不允许新建，或强制合并。

**2. 相似度去重**：

```typescript
function isTooSimilar(a: string, b: string): boolean {
    return levenshtein(a, b) < 3 || a.includes(b) || b.includes(a);
}
```

防止 game_tool / game_tools / gaming_tool / game-assistant 灾难。

**3. 冷却期**：

```typescript
// 新分类创建后 7 天内：不允许再创建相似分类
```

**4. 弱分类自动回收**：

```typescript
if (category.itemCount < 3 && age > 14 days) {
    // 自动标记为 deprecated
    // 项归入 "other"
}
```

**审批流程**：

```typescript
type PendingCategory = {
    key: string;
    name: string;
    description: string;
    proposedBy: "ai";
    itemCount: number;
    sampleItems: string[];
};

// UI: "AI 建议创建新分类「游戏辅助」(3项)，是否采纳？"
// 用户确认 → 添加到 CATEGORY_RULES（受收敛策略约束）
// 用户拒绝 → 这些项归入 "other"
```

### C6: AI 反馈回路

```typescript
type AIFeedback = {
    overrideKey: string;
    originalCategoryKey: string;
    userAction: "accepted" | "rejected" | "modified";
    finalCategoryKey: string;
    timestamp: number;
};
```

### C7: AI 缓存层

```typescript
// key: hash(nameTokens + publisherToken)
// value: categoryKey
const AI_CACHE = new Map<string, string>();

function getCachedAICategory(app: NormalizedApp): string | null {
    const cacheKey = simpleHash(app.nameTokens.join(" ") + "|" + (app.publisherToken || ""));
    return AI_CACHE.get(cacheKey) || null;
}
```

好处：
- 同一软件不重复请求 AI
- 跨用户可共享（未来）

### AI 介入的完整流程

```
扫描完成
  ↓
Phase A 规则引擎分类（3层 Pipeline + Override）
  ↓
过滤：confidence < 0.7 OR isSuspicious
  ↓
AI 缓存命中？→ 直接使用缓存
  ↓ 未命中
发送给 AI（只送不确定/可疑的项）
  ↓
AI 返回结果
  ↓
校验层（id/分类/新分类合法性/相似度）
  ↓
用户确认界面
  ├── 已有分类的改判 → 写入 Override (source="ai", confidence=0.7, decayFactor=0.98)
  ├── 新分类 → 用户审批（受收敛策略约束）→ 添加到 CATEGORY_RULES
  └── 拒绝 → 保持规则引擎结果
  ↓
记录反馈（AIFeedback）
  ↓
写入 AI 缓存
```

### AI 介入的"红线"

| 红线 | 说明 |
|------|------|
| ❌ AI 不能覆盖 Layer1 硬匹配 | chrome.exe 永远是 browser |
| ❌ AI 不能覆盖用户修正 | 用户说是什么就是什么 |
| ❌ AI 不能自动创建分类 | 必须用户确认 + 收敛策略 |
| ❌ AI 不能修改已有分类定义 | 只能建议新分类 |
| ❌ AI 不能绕过 Override 保护 | effective confidence < 0.8 的 AI override 不覆盖硬匹配 |
| ❌ AI override 会衰减 | decayFactor=0.98/天，30天后~0.55 |
| ✅ AI 处理不确定 + 可疑部分 | confidence < 0.7 OR isSuspicious |
| ✅ AI 结果必须经过校验 | id/分类/新分类合法性/相似度 |
| ✅ AI 结果必须用户确认 | 不自动生效 |

### 成本优化

| 优化 | 效果 |
|------|------|
| 只送 confidence < 0.7 或 suspicious 的项 | token 减少 ~70% |
| AI 缓存层 | 同一软件不重复请求 |
| 给 AI 更好的上下文（publisher/exeName） | 准确率提升 |
| 分批发送（每批 20 项） | 降低超时风险 |

---

## Phase D: 规则自进化（AI → Rule Engine 的闭环）

> 真正的分水岭：AI = 规则生成器，而非分类工具。
> 系统会越来越稳定，成本越来越低。

### 核心思路

```
AI 分类 → 统计 pattern → 发现重复模式 → 提出规则 → 用户确认 → 写入规则引擎
```

从"依赖 AI" → "用 AI 训练规则引擎"。

### D1: 模式发现

从 AI 的分类结果中，统计重复出现的模式：

```typescript
type ProposedRule = {
    type: "publisher" | "exe" | "keyword";
    value: string;
    categoryKey: CategoryKey;
    confidence: number;
    evidence: string[];     // 支持此规则的软件名称列表
};

function discoverPatterns(
    aiResults: AIFeedback[],
    overrides: CategoryOverride[]
): ProposedRule[] {
    const patterns: Map<string, ProposedRule> = new Map();

    for (const override of overrides.filter(o => o.source === "ai")) {
        const app = getAppByOverrideKey(override.key);
        if (!app) continue;

        // Publisher 模式
        if (app.publisherToken) {
            const patternKey = `publisher:${app.publisherToken}:${override.categoryKey}`;
            const existing = patterns.get(patternKey);
            if (existing) {
                existing.confidence += 0.1;
                existing.evidence.push(app.name);
            } else {
                patterns.set(patternKey, {
                    type: "publisher",
                    value: app.publisherToken,
                    categoryKey: override.categoryKey,
                    confidence: 0.3,
                    evidence: [app.name],
                });
            }
        }

        // exeName 模式
        if (app.exeName) {
            const patternKey = `exe:${app.exeName}:${override.categoryKey}`;
            // ... 类似逻辑
        }
    }

    // 过滤：只保留 confidence >= 0.7 且 evidence >= 3 的模式
    return [...patterns.values()].filter(
        p => p.confidence >= 0.7 && p.evidence.length >= 3
    );
}
```

### D2: 规则提案

```typescript
type RuleProposal = {
    id: string;
    rule: ProposedRule;
    status: "pending" | "approved" | "rejected";
    createdAt: number;
    reviewedAt: number | null;
};

// UI: "发现模式：发行商 'JetBrains' 的软件通常属于「开发」分类（5项），是否添加为规则？"
// 用户确认 → 写入 CATEGORY_RULES 的 publisherKeywords
// 用户拒绝 → 丢弃
```

### D3: 规则写入

```typescript
function applyApprovedRule(proposal: RuleProposal): void {
    const rule = CATEGORY_RULES.find(r => r.key === proposal.rule.categoryKey);
    if (!rule) return;

    switch (proposal.rule.type) {
        case "publisher":
            if (!rule.publisherKeywords) rule.publisherKeywords = [];
            if (!rule.publisherKeywords.includes(proposal.rule.value)) {
                rule.publisherKeywords.push(proposal.rule.value);
            }
            break;
        case "exe":
            EXE_MAP[proposal.rule.value] = proposal.rule.categoryKey;
            break;
        case "keyword":
            if (!rule.keywords) rule.keywords = [];
            if (!rule.keywords.includes(proposal.rule.value)) {
                rule.keywords.push(proposal.rule.value);
            }
            break;
    }

    // 规则生效后，相关 AI override 可以降权或移除
    // 因为规则引擎已经能处理这些项
}
```

### D4: 自进化闭环

```
AI 分类 → Override 写入 → 模式发现 → 规则提案 → 用户确认 → 规则写入
    ↑                                                        |
    └────────── 规则引擎能力提升 → AI 请求减少 ←───────────────┘
```

**效果**：
- 初期：AI 处理 30% 的项
- 中期：规则引擎覆盖 85%，AI 只处理 15%
- 长期：规则引擎覆盖 92%+，AI 几乎不需要

**成本趋势**：token 消耗随时间递减，最终趋近于零。

### D5: 规则持久化

```typescript
// 用户确认的规则需要持久化，否则重启后丢失
type CustomRules = {
    publisherKeywords: Record<CategoryKey, string[]>;
    exeMappings: Record<string, CategoryKey>;
    keywords: Record<CategoryKey, string[]>;
};

const customRules = ref<CustomRules>({
    publisherKeywords: {},
    exeMappings: {},
    keywords: {},
});
// persist: createVersionedPersistConfig("customRules", ["customRules"])
```

### Phase D 实施优先级

| 优先级 | 模块 | 理由 |
|--------|------|------|
| **P0** | D1: 模式发现 | 核心闭环的起点 |
| **P1** | D2: 规则提案 + UI | 用户确认机制 |
| **P2** | D3: 规则写入 | 闭环完成 |
| **P3** | D5: 规则持久化 | 否则重启丢失 |

---

## 四阶段系统总览

```
Phase A: 规则引擎（确定性）
  → 把"确定性知识"榨干
  → confidence 分层：1.0 / 0.9 / 0.7 / 0.5 / 0.3 / 0

Phase B: 行为反馈（适应性）
  → 把"用户行为"变成反馈回路
  → Override + searchToLaunch + context trigger

Phase C: AI 补位（泛化能力）
  → AI 只处理不确定 + 可疑部分
  → Override 衰减 + 分类收敛 + AI 缓存

Phase D: 规则自进化（自我改进）
  → AI = 规则生成器，而非分类工具
  → 模式发现 → 规则提案 → 用户确认 → 规则写入
```

**系统演化路径**：
- 初期：规则引擎 70% + AI 30%
- 中期：规则引擎 85% + AI 15%
- 长期：规则引擎 92%+ + AI ~0%（成本趋近零）
