export type InstalledAppScanItem = {
    name: string;
    path: string;
    icon_base64: string | null;
    source: string;
};

export type OrganizerSuggestionItem = InstalledAppScanItem & {
    categoryKey: string;
    categoryName: string;
    categoryDescription: string;
    reason: string;
    score: number;
};

export type OrganizerSuggestionCategory = {
    key: string;
    name: string;
    description: string;
    items: OrganizerSuggestionItem[];
};

type CategoryKey =
    | "development"
    | "office"
    | "cloud"
    | "remote"
    | "network"
    | "browser"
    | "design"
    | "media"
    | "gaming"
    | "game_booster"
    | "emulator"
    | "ai"
    | "system"
    | "component"
    | "other";

type CategoryRule = {
    key: CategoryKey;
    name: string;
    description: string;
    exactTerms?: string[];
    keywords?: string[];
    pathKeywords?: string[];
    bias?: number;
};

type ExclusionRule = {
    terms: string[];
    reason: string;
};

type NormalizedApp = InstalledAppScanItem & {
    name: string;
    path: string;
    normalizedName: string;
    normalizedPath: string;
};

const CATEGORY_RULES: CategoryRule[] = [
    {
        key: "development",
        name: "开发",
        description: "编辑器、终端、数据库与开发配套工具",
        exactTerms: [
            "微信开发者工具",
            "visual studio",
            "cursor",
            "another redis desktop manager",
            "finalshell",
            "xshell",
            "sourcetree",
            "navicat",
            "dbeaver",
            "cmake",
            "node.js",
            "python",
            "nvm",
            "sql shell",
            "pgadmin",
            "mu editor",
            "powershell 7",
            "git bash",
            "developer powershell",
            "cygwin64 terminal",
            "tabby terminal",
        ],
        keywords: [
            "webstorm",
            "intellij",
            "pycharm",
            "goland",
            "clion",
            "android studio",
            "github",
            "docker",
            "postman",
            "redis",
            "terminal",
            "powershell",
            "git bash",
            "git",
            "sourcetree",
            "navicat",
            "dbeaver",
            "cmake",
            "node.js",
            "python",
            "nvm",
            "pgadmin",
            "sql shell",
            "psql",
            "finalshell",
            "xshell",
        ],
        pathKeywords: [
            "jetbrains",
            "microsoft visual studio",
            "python",
            "nodejs",
            "postgresql",
            "wechatdevtools",
            "wechat web devtools",
        ],
        bias: 2,
    },
    {
        key: "office",
        name: "办公沟通",
        description: "即时通讯、会议、文档与知识管理工具",
        exactTerms: [
            "微信",
            "qq",
            "telegram",
            "obsidian",
            "word",
            "excel",
            "powerpoint",
            "kook",
            "mumble",
            "discord",
            "企业微信",
            "飞书",
            "钉钉",
        ],
        keywords: [
            "wechat",
            "微信",
            "qq",
            "teams",
            "slack",
            "discord",
            "telegram",
            "zoom",
            "outlook",
            "excel",
            "powerpoint",
            "wps",
            "钉钉",
            "飞书",
            "企业微信",
            "onenote",
            "notion",
            "obsidian",
            "kook",
            "mumble",
        ],
        pathKeywords: ["wps", "tencent meeting", "feishu", "dingtalk"],
    },
    {
        key: "cloud",
        name: "云盘同步",
        description: "网盘、文件同步与跨端传输工具",
        exactTerms: [
            "阿里云盘",
            "百度网盘",
            "夸克网盘",
            "腾讯微云",
            "onedrive",
            "localsend",
        ],
        keywords: ["网盘", "微云", "onedrive", "localsend", "cloud drive", "sync"],
        pathKeywords: ["onedrive", "aliyundrive", "baidunetdisk", "localsend"],
    },
    {
        key: "remote",
        name: "远程连接",
        description: "远程桌面、协助和设备共享工具",
        exactTerms: ["todesk", "remote desktop connection", "quick assist", "sharemouse"],
        keywords: ["todesk", "remote desktop", "quick assist", "sharemouse", "远程桌面"],
    },
    {
        key: "network",
        name: "网络代理",
        description: "代理、网络切换与通道管理工具",
        exactTerms: ["clash verge", "clash", "xagent"],
        keywords: ["clash verge", "clash", "xagent", "v2ray", "proxy", "vpn"],
    },
    {
        key: "browser",
        name: "浏览器",
        description: "网页浏览器与浏览器内核产品",
        exactTerms: ["google chrome", "microsoft edge", "firefox", "brave", "opera", "vivaldi"],
        keywords: ["chrome", "edge", "firefox", "brave", "opera", "vivaldi", "浏览器"],
        pathKeywords: ["chrome", "edge", "firefox", "brave", "vivaldi"],
    },
    {
        key: "design",
        name: "设计创作",
        description: "图像、视频、录屏与内容制作工具",
        exactTerms: [
            "adobe audition",
            "adobe photoshop",
            "adobe premiere pro",
            "obs studio",
            "paint",
            "adobe creative cloud",
            "blender",
        ],
        keywords: [
            "photoshop",
            "illustrator",
            "after effects",
            "premiere",
            "lightroom",
            "figma",
            "blender",
            "davinci",
            "剪映",
            "capcut",
            "obs studio",
            "audition",
            "canva",
            "paint",
        ],
        pathKeywords: ["adobe", "blender", "obs studio"],
    },
    {
        key: "media",
        name: "媒体音频",
        description: "播放器、音频处理和多媒体工具",
        exactTerms: [
            "potplayer",
            "lx music",
            "audacity",
            "handbrake",
            "fxsound",
            "voicemeeter",
            "voicemeeter banana",
            "voicemeeter potato",
            "maono link",
            "windows media player",
        ],
        keywords: [
            "potplayer",
            "lx music",
            "spotify",
            "vlc",
            "mpv",
            "网易云",
            "qq音乐",
            "audacity",
            "handbrake",
            "fxsound",
            "voicemeeter",
            "maono",
            "vban",
            "media player",
        ],
        pathKeywords: ["potplayer", "spotify", "voicemeeter"],
    },
    {
        key: "gaming",
        name: "游戏平台",
        description: "游戏平台、游戏启动器与对战平台",
        exactTerms: [
            "epic games launcher",
            "wegame",
            "steam",
            "ubisoft connect",
            "5e对战平台",
            "完美世界竞技平台",
            "ea app",
        ],
        keywords: [
            "steam",
            "epic games",
            "wegame",
            "ubisoft connect",
            "battle.net",
            "battlenet",
            "riot client",
            "riot",
            "5e对战平台",
            "完美世界竞技平台",
            "英雄联盟",
            "cfhd",
            "三角洲行动",
            "dead island",
        ],
        pathKeywords: ["steam", "epic games", "riot games", "wegame", "ubisoft"],
    },
    {
        key: "game_booster",
        name: "游戏加速器",
        description: "游戏网络加速、帧率优化与游戏性能辅助工具",
        exactTerms: [
            "uu加速器",
            "ak加速器",
            "verykuai vk加速器",
            "watt toolkit",
            "雷神加速器",
            "迅游加速器",
            "biubiu加速器",
            "海豚加速器",
        ],
        keywords: [
            "游戏加速",
            "加速器",
            "game booster",
            "booster",
            "watt toolkit",
            "lossless scaling",
            "uu",
            "迅游",
            "雷神加速器",
            "biubiu",
            "海豚加速",
        ],
        pathKeywords: [
            "uu",
            "qiyou",
            "xunyou",
            "booster",
            "watt toolkit",
            "lossless scaling",
        ],
        bias: 2,
    },
    {
        key: "emulator",
        name: "模拟器",
        description: "安卓模拟器与多开相关工具",
        exactTerms: [
            "雷电模拟器9",
            "雷电模拟器",
            "雷电多开器",
            "逍遥模拟器",
            "逍遥多开器",
            "bluestacks",
        ],
        keywords: ["模拟器", "多开器", "bluestacks", "雷电", "逍遥"],
        pathKeywords: ["ldplayer", "leidian", "bluestacks", "memu"],
        bias: 1,
    },
    {
        key: "ai",
        name: "AI 工具",
        description: "大模型客户端、推理工具与 AI 助手",
        exactTerms: ["chatgpt", "claude", "copilot", "ollama", "comfyui", "kimi", "豆包"],
        keywords: [
            "chatgpt",
            "claude",
            "copilot",
            "ollama",
            "comfyui",
            "stable diffusion",
            "midjourney",
            "kimi",
            "豆包",
            "通义",
            "文心",
        ],
        pathKeywords: ["ollama", "comfyui", "stable diffusion"],
    },
    {
        key: "system",
        name: "系统工具",
        description: "压缩、搜索、截图、硬件与系统增强工具",
        exactTerms: [
            "command prompt",
            "control panel",
            "everything",
            "file explorer",
            "internet explorer",
            "snipping tool",
            "task manager",
            "winrar",
            "utools",
            "pixpin",
            "图吧工具箱",
            "分区助手",
            "hasleo easyuefi",
            "character map",
            "notepad",
            "run",
            "magnify",
            "narrator",
        ],
        keywords: [
            "everything",
            "powertoys",
            "7-zip",
            "bandizip",
            "winrar",
            "file explorer",
            "资源管理器",
            "snipping tool",
            "截图",
            "task manager",
            "任务管理器",
            "control panel",
            "控制面板",
            "utools",
            "pixpin",
            "图吧工具箱",
            "分区助手",
            "easyuefi",
            "character map",
            "notepad",
            "run",
            "magnify",
            "narrator",
            "串口通信工具",
            "pc manager",
        ],
        pathKeywords: ["powertoys", "7-zip", "bandizip", "winrar"],
    },
    {
        key: "component",
        name: "系统组件",
        description: "SDK、运行库、后台组件与无界面工具",
        keywords: [
            "runtime",
            "redistributable",
            "sdk",
            "framework",
            "vc++",
            "vcredist",
            ".net",
            "driver package",
            "service host",
            "后台服务",
            "无界面",
            "组件",
            "运行库",
        ],
        pathKeywords: ["runtime", "redistributable", "sdk", "framework", "common files", "drivers"],
        bias: 1,
    },
];

const FALLBACK_CATEGORY: CategoryRule = {
    key: "other",
    name: "其他",
    description: "暂时无法稳定归类的软件",
};

const EXCLUSION_RULES: ExclusionRule[] = [
    {
        reason: "安装、升级或修复入口",
        terms: [
            "安装选项",
            "检查新版本",
            "update",
            "updater",
            "更新程序",
            "installer",
            "setup",
            "repair",
            "recovery",
            "stack builder",
        ],
    },
    {
        reason: "帮助、官网或说明入口",
        terms: [
            "官网",
            "网站",
            "website",
            "about java",
            "关于 java",
            "帮助",
            "help",
            "manual",
            "manuals",
            "documentation",
            "readme",
            "release notes",
            "changelog",
        ],
    },
    {
        reason: "维护、卸载或辅助入口",
        terms: [
            "卸载",
            "uninstall",
            "unins",
            "remove",
            "удалить",
            "error reporter",
            "telemetry",
            "遥测",
            "语言首选项",
            "语言",
            "user dictionary",
            "用户词典",
            "administrative tools",
            "application verifier",
            "app cert kit",
        ],
    },
];

const NON_LAUNCHABLE_TERMS = [
    "runtime",
    "redistributable",
    "sdk",
    "framework",
    "vc++",
    "vcredist",
    ".net",
    "driver package",
    "service host",
    "daemon",
    "headless",
    "后台服务",
    "无界面",
    "运行库",
    "组件",
    "system component",
];

const CATEGORY_BY_KEY = new Map(CATEGORY_RULES.map((rule) => [rule.key, rule]));

export type OrganizerCategoryRule = {
    key: string;
    name: string;
    description: string;
};

export function buildOrganizerSuggestions(
    apps: InstalledAppScanItem[]
): OrganizerSuggestionCategory[] {
    const grouped = new Map<string, OrganizerSuggestionCategory>();

    for (const app of normalizeApps(apps)) {
        if (shouldExcludeApp(app)) {
            continue;
        }

        const matched = classifyInstalledApp(app);
        const nextItem: OrganizerSuggestionItem = {
            ...app,
            categoryKey: matched.rule.key,
            categoryName: matched.rule.name,
            categoryDescription: matched.rule.description,
            reason: matched.reason,
            score: matched.score,
        };

        const existing = grouped.get(matched.rule.key);
        if (existing) {
            existing.items.push(nextItem);
            continue;
        }

        grouped.set(matched.rule.key, {
            key: matched.rule.key,
            name: matched.rule.name,
            description: matched.rule.description,
            items: [nextItem],
        });
    }

    return [...grouped.values()]
        .map((category) => ({
            ...category,
            items: [...category.items].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
        }))
        .sort((a, b) => {
            const rankDiff = getCategorySortRank(a.key) - getCategorySortRank(b.key);
            if (rankDiff !== 0) {
                return rankDiff;
            }
            return b.items.length - a.items.length || a.name.localeCompare(b.name);
        });
}

function normalizeApps(apps: InstalledAppScanItem[]): NormalizedApp[] {
    const seenPaths = new Set<string>();
    const seenAliases = new Set<string>();
    const normalized: NormalizedApp[] = [];

    for (const app of apps) {
        const name = normalizeAppName(app.name);
        const path = app.path.trim();
        if (!name || !path) continue;

        const normalizedName = normalizeTextForMatching(name);
        const normalizedPath = normalizeTextForMatching(path);
        const pathKey = path.toLowerCase();
        const aliasKey = `${normalizedName}::${extractExecutableBaseName(path)}`;

        if (seenPaths.has(pathKey) || seenAliases.has(aliasKey)) {
            continue;
        }

        seenPaths.add(pathKey);
        seenAliases.add(aliasKey);

        normalized.push({
            ...app,
            name,
            path,
            normalizedName,
            normalizedPath,
        });
    }

    return normalized;
}

function normalizeAppName(name: string): string {
    return name
        .normalize("NFKC")
        .replace(/\.(lnk|exe)$/gi, "")
        .replace(/[()（）]+/g, " ")
        .replace(/\s+/g, " ")
        .replace(/\b(x64|x86|64-bit|32-bit)\b/gi, "")
        .trim();
}

function normalizeTextForMatching(value: string): string {
    return value
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[._\-\\/()[\]{}【】（）]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function extractExecutableBaseName(path: string): string {
    const normalized = path.replace(/\\/g, "/").toLowerCase();
    const lastSegment = normalized.split("/").pop() || normalized;
    return lastSegment.replace(/\.(lnk|exe|bat|cmd)$/gi, "");
}

function shouldExcludeApp(app: NormalizedApp): boolean {
    return EXCLUSION_RULES.some((rule) =>
        rule.terms.some((term) => matchesTerm(app.normalizedName, term) || matchesTerm(app.normalizedPath, term))
    );
}

function classifyInstalledApp(app: NormalizedApp): {
    rule: CategoryRule;
    reason: string;
    score: number;
} {
    if (isLikelyNonLaunchableItem(app)) {
        const componentRule = CATEGORY_BY_KEY.get("component") || FALLBACK_CATEGORY;
        return {
            rule: componentRule,
            reason: "命中组件特征：运行库/后台工具",
            score: 980,
        };
    }

    if (matchesTerm(app.normalizedName, "微信开发者工具")) {
        const developmentRule = CATEGORY_BY_KEY.get("development") || FALLBACK_CATEGORY;
        return {
            rule: developmentRule,
            reason: "命中应用映射：微信开发者工具",
            score: 999,
        };
    }

    let bestRule = FALLBACK_CATEGORY;
    let bestScore = 0;
    let bestReason = "未命中特征词，先归到其他";

    for (const rule of CATEGORY_RULES) {
        const matchedExactTerms = (rule.exactTerms || []).filter((term) =>
            matchesTerm(app.normalizedName, term)
        );
        const matchedKeywords = (rule.keywords || []).filter((term) =>
            matchesTerm(app.normalizedName, term)
        );
        const matchedPathKeywords = (rule.pathKeywords || []).filter((term) =>
            matchesTerm(app.normalizedPath, term)
        );

        const hitCount =
            matchedExactTerms.length + matchedKeywords.length + matchedPathKeywords.length;
        const score =
            matchedExactTerms.length * 80 +
            matchedKeywords.length * 24 +
            matchedPathKeywords.length * 10 +
            (hitCount > 0 ? rule.bias || 0 : 0);

        if (score <= bestScore) {
            continue;
        }

        bestRule = rule;
        bestScore = score;
        bestReason = buildReason(matchedExactTerms, matchedKeywords, matchedPathKeywords);
    }

    return {
        rule: bestRule,
        reason: bestReason,
        score: bestScore,
    };
}

function buildReason(
    matchedExactTerms: string[],
    matchedKeywords: string[],
    matchedPathKeywords: string[]
): string {
    if (matchedExactTerms.length > 0) {
        return `命中应用映射：${matchedExactTerms.slice(0, 2).join(" / ")}`;
    }
    if (matchedKeywords.length > 0) {
        return `命中关键词：${matchedKeywords.slice(0, 2).join(" / ")}`;
    }
    if (matchedPathKeywords.length > 0) {
        return `命中安装路径：${matchedPathKeywords[0]}`;
    }
    return "未命中特征词，先归到其他";
}

function matchesTerm(text: string, rawTerm: string): boolean {
    const term = normalizeTextForMatching(rawTerm);
    if (!term) {
        return false;
    }

    if (containsCjk(term)) {
        return text.includes(term);
    }

    const escaped = escapeRegExp(term).replace(/\s+/g, "\\s+");
    const pattern = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
    return pattern.test(text);
}

function containsCjk(value: string): boolean {
    return /[\u3400-\u9fff]/.test(value);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getCategorySortRank(key: string): number {
    if (key === "other") return 3;
    if (key === "component") return 2;
    return 1;
}

export function isLikelyNonLaunchableItem(app: Pick<InstalledAppScanItem, "name" | "path">): boolean {
    const normalizedName = normalizeTextForMatching(normalizeAppName(app.name || ""));
    const normalizedPath = normalizeTextForMatching(app.path || "");

    if (!normalizedName && !normalizedPath) {
        return false;
    }

    return NON_LAUNCHABLE_TERMS.some(
        (term) => matchesTerm(normalizedName, term) || matchesTerm(normalizedPath, term)
    );
}

export function shouldDefaultSelectOrganizerItem(app: Pick<InstalledAppScanItem, "name" | "path">): boolean {
    return !isLikelyNonLaunchableItem(app);
}

export function getOrganizerCategoryRule(key: string): CategoryRule {
    return CATEGORY_BY_KEY.get(key as CategoryKey) || FALLBACK_CATEGORY;
}

export function getOrganizerCategories(includeFallback = true): OrganizerCategoryRule[] {
    const rules = CATEGORY_RULES.map(({ key, name, description }) => ({
        key,
        name,
        description,
    }));
    return includeFallback
        ? [
            ...rules,
            {
                key: FALLBACK_CATEGORY.key,
                name: FALLBACK_CATEGORY.name,
                description: FALLBACK_CATEGORY.description,
            },
        ]
        : rules;
}
