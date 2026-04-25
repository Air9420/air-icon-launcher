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
