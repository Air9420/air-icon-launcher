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

describe("classifyInstalledApp - 游戏加速器 (game_booster)", () => {
    it("雷神加速器 leigod → game_booster, confidence=1.0", () => {
        const app = makeApp({
            name: "雷神加速器",
            path: "E:\\LeiGod_Acc\\leigod.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("game_booster");
        expect(result.confidence).toBe(1.0);
    });

    it("Watt Toolkit (steam++) → game_booster, confidence=1.0", () => {
        const app = makeApp({
            name: "Watt Toolkit",
            path: "E:\\steamPP\\Steam++\\Steam++.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("game_booster");
    });

    it("UU加速器 → game_booster", () => {
        const app = makeApp({
            name: "UU加速器",
            path: "Z:\\外服加速器\\Netease\\UU\\uu_launcher.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("game_booster");
    });

    it("游戏加加 GamePP → game_booster", () => {
        const app = makeApp({
            name: "游戏加加",
            path: "Z:\\Apps\\GamePP\\GamePP.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("game_booster");
    });
});

describe("classifyInstalledApp - 游戏平台 (gaming)", () => {
    it("EALauncher.exe → gaming", () => {
        const app = makeApp({
            name: "EA",
            path: "C:\\Program Files\\Electronic Arts\\EA Desktop\\EA Desktop\\EALauncher.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("gaming");
    });

    it("EAappInstaller in Package Cache → component (正确行为：安装缓存)", () => {
        const app = makeApp({
            name: "EA app",
            path: "C:\\ProgramData\\Package Cache\\{cacc560a-9ede-4f2f-ba96-fef05cf7bb1d}\\EAappInstaller.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("component");
    });
});

describe("classifyInstalledApp - 远程连接 (remote)", () => {
    it("ToDesk → remote", () => {
        const app = makeApp({
            name: "ToDesk",
            path: "E:\\Todesk\\ToDesk.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("remote");
    });
});

describe("classifyInstalledApp - 云盘 (cloud)", () => {
    it("阿里云盘 → cloud", () => {
        const app = makeApp({
            name: "阿里云盘",
            path: "C:\\Users\\Air\\AppData\\Local\\Programs\\aDrive\\aDrive.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("cloud");
    });

    it("夸克网盘 → cloud", () => {
        const app = makeApp({
            name: "夸克网盘",
            path: "Z:\\下载工具\\Quark\\quark.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("cloud");
    });

    it("LocalSend → cloud", () => {
        const app = makeApp({
            name: "LocalSend 版本 1.17.0",
            path: "Z:\\Apps\\小工具\\LocalSend\\localsend_app.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("cloud");
    });
});

describe("classifyInstalledApp - 开发工具 (development)", () => {
    it("Xshell → development", () => {
        const app = makeApp({
            name: "Xshell 7",
            path: "Z:\\Xshell\\Xshell.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("development");
    });

    it("FinalShell → development", () => {
        const app = makeApp({
            name: "FinalShell",
            path: "E:\\finalshell\\finalshell.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("development");
    });

    it("Navicat → development", () => {
        const app = makeApp({
            name: "PremiumSoft Navicat Premium 16.0",
            path: "E:\\Navicat Premium 16\\navicat.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("development");
    });

    it("CMake → development", () => {
        const app = makeApp({
            name: "CMake cmake gui",
            path: "Z:\\Cmake\\bin\\cmake-gui.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("development");
    });

    it("Bun → development", () => {
        const app = makeApp({
            name: "Bun",
            path: "C:\\Users\\Air\\.bun\\bin\\bun.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("development");
    });

    it("NVM for Windows → development", () => {
        const app = makeApp({
            name: "NVM for Windows 1.1.12",
            path: "Z:\\nvm\\nvm.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("development");
    });
});

describe("classifyInstalledApp - 模拟器 (emulator)", () => {
    it("雷电模拟器 → emulator", () => {
        const app = makeApp({
            name: "雷电模拟器",
            path: "Z:\\Apps\\安卓模拟器\\leidian\\LDPlayer9\\dnplayer.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("emulator");
    });
});

describe("classifyInstalledApp - 网络代理 (network)", () => {
    it("Clash Verge → network", () => {
        const app = makeApp({
            name: "Clash Verge",
            path: "Z:\\Apps\\clash-verge-rev\\clash-verge.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("network");
    });
});

describe("classifyInstalledApp - 办公 (office)", () => {
    it("腾讯会议 → office", () => {
        const app = makeApp({
            name: "腾讯会议",
            path: "Z:\\Apps\\腾讯会议\\WeMeet\\WeMeetApp.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("office");
    });

    it("KOOK → office", () => {
        const app = makeApp({
            name: "KOOK",
            path: "Z:\\应用\\KOOK\\KOOK.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("office");
    });
});

describe("classifyInstalledApp - 系统工具 (system)", () => {
    it("Dism++ → system", () => {
        const app = makeApp({
            name: "Dism++.exe 快捷方式",
            path: "Z:\\Dism++\\Dism++x64.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("system");
    });

    it("分区助手 → system", () => {
        const app = makeApp({
            name: "分区助手 10.0.0",
            path: "E:\\AOMEI Partition Assistant\\PartAssist.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("system");
    });

    it("图吧工具箱 → system", () => {
        const app = makeApp({
            name: "图吧工具箱202601",
            path: "Z:\\Apps\\图吧工具箱202601\\图吧工具箱2026.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("system");
    });

    it("火绒安全软件 → system", () => {
        const app = makeApp({
            name: "火绒安全软件",
            path: "Z:\\火绒\\Huorong\\Sysdiag\\bin\\HipsMain.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("system");
    });

    it("ATK V HUB → system", () => {
        const app = makeApp({
            name: "ATK V HUB2.3.68",
            path: "Z:\\Apps\\ATK_V_HUB\\ATK V HUB.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("system");
    });

    it("MCHOSE HUB → system", () => {
        const app = makeApp({
            name: "MCHOSE HUB",
            path: "Z:\\Apps\\迈从HUB\\MCHOSE HUB\\MCHOSE HUB.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("system");
    });

    it("ProcessLassoLauncher → system", () => {
        const app = makeApp({
            name: "Process Lasso",
            path: "Z:\\应用\\Process Lasso\\ProcessLassoLauncher.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("system");
    });
});

describe("classifyInstalledApp - 网络代理 (network)", () => {
    it("Wireshark → network", () => {
        const app = makeApp({
            name: "Wireshark 4.4.3",
            path: "Z:\\Apps\\Wireshark\\Wireshark.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("network");
    });
});

describe("classifyInstalledApp - 开发工具 (development)", () => {
    it("Xshell → development", () => {
        const app = makeApp({
            name: "Xshell 7",
            path: "Z:\\Xshell\\Xshell.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("development");
    });

    it("FinalShell → development", () => {
        const app = makeApp({
            name: "FinalShell",
            path: "E:\\finalshell\\finalshell.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("development");
    });

    it("Navicat → development", () => {
        const app = makeApp({
            name: "PremiumSoft Navicat Premium 16.0",
            path: "E:\\Navicat Premium 16\\navicat.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("development");
    });

    it("CMake → development", () => {
        const app = makeApp({
            name: "CMake cmake gui",
            path: "Z:\\Cmake\\bin\\cmake-gui.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("development");
    });

    it("Bun → development", () => {
        const app = makeApp({
            name: "Bun",
            path: "C:\\Users\\Air\\.bun\\bin\\bun.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("development");
    });

    it("NVM for Windows → development", () => {
        const app = makeApp({
            name: "NVM for Windows 1.1.12",
            path: "Z:\\nvm\\nvm.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("development");
    });

    it("PowerShell 7 → development", () => {
        const app = makeApp({
            name: "PowerShell 7",
            path: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("development");
    });

    it("Nsight Compute → development", () => {
        const app = makeApp({
            name: "Nsight Compute",
            path: "C:\\Program Files\\NVIDIA Corporation\\Nsight Compute 2021.2.2\\host\\windows-desktop-win7-x64\\ncu-ui.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("development");
    });

    it("Nsight Systems → development", () => {
        const app = makeApp({
            name: "Nsight Systems 2023.3.3",
            path: "C:\\Program Files\\NVIDIA Corporation\\Nsight Systems 2023.3.3\\host-windows-x64\\nsys-ui.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("development");
    });
});

describe("classifyInstalledApp - 模拟器 (emulator)", () => {
    it("雷电模拟器 → emulator", () => {
        const app = makeApp({
            name: "雷电模拟器",
            path: "Z:\\Apps\\安卓模拟器\\leidian\\LDPlayer9\\dnplayer.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("emulator");
    });

    it("逍遥多开器 → emulator", () => {
        const app = makeApp({
            name: "逍遥多开器",
            path: "Z:\\Apps\\Microvirt\\MEmu\\MEmuConsole.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("emulator");
    });
});

describe("classifyInstalledApp - 网络代理 (network)", () => {
    it("Clash Verge → network", () => {
        const app = makeApp({
            name: "Clash Verge",
            path: "Z:\\Apps\\clash-verge-rev\\clash-verge.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("network");
    });
});

describe("classifyInstalledApp - 办公 (office)", () => {
    it("腾讯会议 → office", () => {
        const app = makeApp({
            name: "腾讯会议",
            path: "Z:\\Apps\\腾讯会议\\WeMeet\\WeMeetApp.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("office");
    });

    it("KOOK → office", () => {
        const app = makeApp({
            name: "KOOK",
            path: "Z:\\应用\\KOOK\\KOOK.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("office");
    });

    it("TeamSpeak → office", () => {
        const app = makeApp({
            name: "TeamSpeak",
            path: "C:\\Users\\Air\\AppData\\Local\\Programs\\TeamSpeak\\TeamSpeak.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("office");
    });

    it("Mumble → office", () => {
        const app = makeApp({
            name: "Mumble",
            path: "C:\\Program Files\\Mumble\\client\\mumble.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("office");
    });

    it("Oopz → office (游戏语音，不是 AI)", () => {
        const app = makeApp({
            name: "Oopz",
            path: "Z:\\oopz\\oopz.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("office");
    });

    it("QQScLauncher → office", () => {
        const app = makeApp({
            name: "腾讯QQ",
            path: "E:\\QQ\\Bin\\QQScLauncher.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("office");
    });
});

describe("classifyInstalledApp - 游戏平台 (gaming)", () => {
    it("EALauncher.exe → gaming", () => {
        const app = makeApp({
            name: "EA",
            path: "C:\\Program Files\\Electronic Arts\\EA Desktop\\EA Desktop\\EALauncher.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("gaming");
    });

    it("5E对战平台 → gaming (对战平台不是加速器)", () => {
        const app = makeApp({
            name: "5E对战平台",
            path: "Z:\\Apps\\5ePlay\\5EClient\\5EClient.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("gaming");
    });

    it("完美世界竞技平台 → gaming", () => {
        const app = makeApp({
            name: "完美世界竞技平台 1.0.25121811",
            path: "Z:\\Apps\\完美世界\\完美世界竞技平台.exe",
        });
        const result = classifyInstalledApp(app);
        expect(result.rule.key).toBe("gaming");
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
