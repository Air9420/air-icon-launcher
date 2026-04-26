import { describe, it, expect } from "vitest";
import { classifyInstalledApp } from "../pipeline";
import { normalizeApp } from "../normalizer";
import type { NormalizedApp } from "../types";

function makeApp(overrides: Partial<NormalizedApp> & { name: string; path: string }): NormalizedApp {
    return normalizeApp({
        name: overrides.name,
        path: overrides.path,
        icon_base64: overrides.icon_base64 ?? null,
        source: overrides.source ?? "registry",
        publisher: overrides.publisher ?? null,
    });
}

describe("classifyInstalledApp - Layer 1: EXE_MAP 硬匹配", () => {
    it("chrome.exe → browser, confidence=1.0", () => {
        const app = makeApp({
            name: "Google Chrome",
            path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            publisher: "Google LLC",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("browser");
        expect(result.confidence).toBe(1.0);
    });

    it("code.exe → development, confidence=1.0", () => {
        const app = makeApp({
            name: "Visual Studio Code",
            path: "C:\\Users\\test\\AppData\\Local\\Programs\\Microsoft VS Code\\code.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("development");
        expect(result.confidence).toBe(1.0);
    });

    it("steam.exe → gaming, confidence=1.0", () => {
        const app = makeApp({
            name: "Steam",
            path: "C:\\Program Files\\Steam\\steam.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("gaming");
        expect(result.confidence).toBe(1.0);
    });
});

describe("classifyInstalledApp - Layer 1: exactTerms 匹配", () => {
    it("exactTerm '浏览器' → browser", () => {
        const app = makeApp({
            name: "浏览器",
            path: "C:\\Apps\\browser.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("browser");
        expect(result.confidence).toBe(1.0);
    });
});

describe("classifyInstalledApp - Layer 2: Publisher 匹配", () => {
    it("JetBrains publisher → development, confidence=0.9", () => {
        const app = makeApp({
            name: "RubyMine",
            path: "C:\\Program Files\\JetBrains\\RubyMine\\bin\\rubymine64.exe",
            publisher: "JetBrains s.r.o.",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("development");
        expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("Adobe Systems publisher → design, confidence=0.9", () => {
        const app = makeApp({
            name: "Adobe Creative Cloud",
            path: "C:\\Program Files\\Adobe\\Creative Cloud\\ACC.exe",
            publisher: "Adobe Systems Inc.",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("design");
        expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });
});

describe("classifyInstalledApp - Layer 2: Δ阈值裁决", () => {
    it("Publisher 0.9 vs Path 0.7 → 选 Publisher (Δ=0.2 > 0.15)", () => {
        const app = makeApp({
            name: "JetBrains Tool",
            path: "C:\\Program Files\\Utilities\\jbt.exe",
            publisher: "JetBrains s.r.o.",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("development");
        expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });
});

describe("classifyInstalledApp - Heuristics", () => {
    it("pathToken 'games' → gaming, confidence=0.3", () => {
        const app = makeApp({
            name: "SomeGameLauncher",
            path: "C:\\Games\\SomeGameLauncher\\launcher.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("gaming");
        expect(result.confidence).toBe(0.3);
    });

    it("pathToken 'jetbrains' → development, confidence=0.3", () => {
        const app = makeApp({
            name: "UnknownJetBrainsTool",
            path: "C:\\Program Files\\JetBrains\\UnknownTool\\tool.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("development");
        expect(result.confidence).toBeGreaterThanOrEqual(0.3);
    });
});

describe("classifyInstalledApp - Layer 3: 软评分", () => {
    it("keyword 'chrome' → browser, confidence=0.5", () => {
        const app = makeApp({
            name: "Chrome Remote Desktop",
            path: "C:\\Program Files\\Chrome Remote Desktop\\crd.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("browser");
        expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });
});

describe("classifyInstalledApp - 兜底: other", () => {
    it("未知软件 → other, confidence=0", () => {
        const app = makeApp({
            name: "XyzAbc123",
            path: "C:\\Users\\test\\AppData\\Local\\XyzAbc123\\app.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("other");
        expect(result.confidence).toBe(0);
    });
});

describe("classifyInstalledApp - Layer 0: 组件检测", () => {
    it("runtime → component, confidence=0.95", () => {
        const app = makeApp({
            name: "Microsoft Visual C++ Runtime",
            path: "C:\\Windows\\System32\\vcruntime140.dll",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("component");
        expect(result.confidence).toBeGreaterThanOrEqual(0.95);
    });

    it("redistributable → component", () => {
        const app = makeApp({
            name: "Microsoft Visual C++ 2019 Redistributable",
            path: "C:\\Program Files\\VCRedist\\vc_redist.x64.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("component");
    });

    it("python setup in Package Cache → component", () => {
        const app = makeApp({
            name: "Python 3.12.1 64 bit",
            path: "C:\\Users\\Air\\AppData\\Local\\Package Cache\\{86e52725-ef45-452f-ac4c-b8958718bfea}\\python-3.12.1-amd64.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("component");
        expect(result.confidence).toBeGreaterThanOrEqual(0.95);
    });

    it("setup.exe in Package Cache → component", () => {
        const app = makeApp({
            name: "PowerShell 7.4.2.0",
            path: "C:\\ProgramData\\Package Cache\\{57ab3d40-c876-4caf-88cd-3bbfc669479c}\\PowerShell-7.4.2-win-x64.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("component");
    });
});

describe("classifyInstalledApp - Normalization", () => {
    it("PyCharm 2024.1 → tokens 去版本号", () => {
        const app = makeApp({
            name: "PyCharm 2024.1",
            path: "C:\\Program Files\\JetBrains\\PyCharm 2024.1\\bin\\pycharm64.exe",
            publisher: "JetBrains s.r.o.",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("development");
    });

    it("Publisher 'Microsoft Corporation' → token 'microsoft'", () => {
        const app = makeApp({
            name: "Microsoft Edge",
            path: "C:\\Program Files\\Microsoft\\Edge\\msedge.exe",
            publisher: "Microsoft Corporation",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("browser");
    });
});
