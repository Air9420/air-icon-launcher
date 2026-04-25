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
