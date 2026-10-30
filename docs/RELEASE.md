# 发布流程（Release Guide）

> 面向：接手本项目的 AI 会话 / 开发者。
> 目标：一次走通，不踩凭证、签名、上传的坑。
> 最近验证：v0.7.3（2026-10-30）

---

## 0. 一页速查

```powershell
# 1) 定版本号（见 §2）
# 2) 改 3 个文件 + latest.json（见 §3）
bun run check

# 3) 编译（必须带签名环境变量，见 §4）
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "Xzq95199"
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content "Z:\VScodeProject\air-icon-launcher\private.key" -Raw)
bun tauri build

# 4) 提交 + 打标签
git add -A
git commit -m "chore(release): 发布 x.y.z"
git tag -a vx.y.z -m "Release vx.y.z"

# 5) 推送（关键：必须禁用交互提示，见 §6）
$env:GIT_TERMINAL_PROMPT = "0"; $env:GCM_INTERACTIVE = "never"
git -c credential.interactive=false push origin main
git -c credential.interactive=false push origin vx.y.z
git -c credential.interactive=false push gitee main
git -c credential.interactive=false push gitee vx.y.z

# 6) GitHub Release（见 §7）
# 7) Gitee Release（见 §8）
```

---

## 1. 前置检查

```powershell
cd Z:\VScodeProject\air-icon-launcher

# 工作区必须干净，否则先提交或 stash
git status --short

# 确认远程
git remote -v
# origin → github.com/Air9420/air-icon-launcher.git
# gitee  → gitee.com/air9420/air-icon-launcher.git

# 确认 gh 已登录
gh auth status
```

**关闭 dev 服务**：编译前先停掉 `air-icon-launcher.exe`，否则文件被占用会导致打包失败。

```powershell
Get-Process -Name "air-icon-launcher" -ErrorAction SilentlyContinue | Stop-Process -Force
```

---

## 2. 确定版本号

```powershell
git log v<上一版本>..HEAD --oneline
```

| 提交类型 | 版本变化 | 示例 |
|---|---|---|
| 含 `feat` | minor | 0.7.3 → 0.8.0 |
| 只有 `fix` / `perf` / `refactor` / `style` | patch | 0.7.2 → 0.7.3 |

> ⚠️ **必须询问用户确认**。用户可能认为 `feat` 只是修复，倾向于走 patch。
> v0.7.3 实际含 `feat: 剪贴板历史改用虚拟列表`，按规则应为 0.8.0，但用户选择了 0.7.3。

---

## 3. 更新版本号与 latest.json

### 3.1 三个文件

| 文件 | 字段 |
|---|---|
| `package.json` | `"version": "x.y.z"` |
| `src-tauri/Cargo.toml` | `version = "x.y.z"` |
| `src-tauri/tauri.conf.json` | `"version": "x.y.z"` |

`src-tauri/Cargo.lock` 会在 `bun tauri build` 时自动更新，无需手改。

把下面的 `OLD` / `NEW` 换成实际版本号（例如 `0.7.3` → `0.7.4`）：

```powershell
$OLD = "0.7.3"; $NEW = "0.7.4"
(Get-Content package.json -Raw).Replace('"version": "'+$OLD+'"', '"version": "'+$NEW+'"') | Set-Content package.json -NoNewline
(Get-Content src-tauri/Cargo.toml -Raw).Replace('version = "'+$OLD+'"', 'version = "'+$NEW+'"') | Set-Content src-tauri/Cargo.toml -NoNewline
(Get-Content src-tauri/tauri.conf.json -Raw).Replace('"version": "'+$OLD+'"', '"version": "'+$NEW+'"') | Set-Content src-tauri/tauri.conf.json -NoNewline
```

改完用下面命令确认三处一致：

```powershell
(Get-Content package.json -Raw | ConvertFrom-Json).version
(Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json).version
Select-String -Path src-tauri/Cargo.toml -Pattern '^version'
```

### 3.2 latest.json（自动更新清单）

**必须在编译拿到签名之后才能写完整**，因为 `signature` 来自编译产物。

```json
{
  "version": "x.y.z",
  "notes": "## vx.y.z\n\n### 优化\n- ...\n\n### 修复\n- ...",
  "pub_date": "2026-10-30T02:19:00.000Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<从 .sig 文件复制的完整内容>",
      "url": "https://github.com/Air9420/air-icon-launcher/releases/download/vx.y.z/air-icon-launcher_x.y.z_x64-setup.nsis.zip"
    }
  }
}
```

注意：
- `notes` 里换行用 `\n`（JSON 字符串），不要真的换行
- `url` 必须指向 `nsis.zip`（更新包），不是 `.exe`
- `signature` 是 `.nsis.zip.sig` 的**完整内容**（约 436 字符）

---

## 4. 编译

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "Xzq95199"
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content "Z:\VScodeProject\air-icon-launcher\private.key" -Raw)
bun tauri build
```

- 耗时约 **3 分钟**（release profile 开了 LTO，属正常）
- 产物在 `src-tauri\target\release\bundle\nsis\`
- 不设这两个环境变量 → 不会生成 `.sig`，自动更新会失效

### 产物清单

| 文件 | 用途 |
|---|---|
| `air-icon-launcher_x.y.z_x64-setup.exe` | 手动安装包（约 5.8 MB） |
| `air-icon-launcher_x.y.z_x64-setup.nsis.zip` | **自动更新包**（约 5.8 MB） |
| `...nsis.zip.sig` | 更新包签名（约 436 B） |
| `latest.json` | 更新清单 |

---

## 5. 获取签名

```powershell
Get-Content "src-tauri\target\release\bundle\nsis\air-icon-launcher_x.y.z_x64-setup.nsis.zip.sig" -Raw
```

把输出原样填入 `latest.json` 的 `signature`。

**自检**：签名解码后应包含 `file:air-icon-launcher_x.y.z_x64-setup.nsis.zip`。

```powershell
$sig = (Get-Content "...\.sig" -Raw).Trim()
[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($sig))
```

---

## 6. 推送（凭证坑集中区）

### 6.1 为什么新会话会卡死

本机 `credential.helper=manager`（Git Credential Manager）。凭证**已经缓存好了**，
但 GCM 默认会在需要时**弹出 GUI 窗口**等待点击。
在 AI 会话 / 非交互 shell 里没人点那个窗口，于是 `git push` 无限挂起
（实测卡满 5 分钟无输出）。

**根因不是凭证缺失，而是交互式弹窗。**

### 6.2 正确做法

```powershell
$env:GIT_TERMINAL_PROMPT = "0"
$env:GCM_INTERACTIVE = "never"
git -c credential.interactive=false push origin main
```

三者任一生效即可，**建议全加上**，双保险。

### 6.3 永久修复（推荐做一次）

仓库级持久化，之后新会话不用再设环境变量：

```powershell
cd Z:\VScodeProject\air-icon-launcher
git config --local credential.interactive false
git config --local --get credential.interactive   # 应输出 false
```

> 这是本仓库配置，随 `.git/config` 保存在本地，不会被提交。

### 6.4 验证凭证是否真的可用

```powershell
# 只看是否有凭证，不联网、不弹窗
echo "protocol=https`nhost=github.com`n`n" | git credential fill
echo "protocol=https`nhost=gitee.com`n`n" | git credential fill
```

正常应 1 秒内返回 `username` / `password`。若卡住，说明凭证真的缺失，需重新登录：

```powershell
gh auth login          # GitHub
git push gitee main    # Gitee 会提示输入账号密码
```

### 6.5 推送顺序

```powershell
git push origin main && git push origin vx.y.z    # GitHub
git push gitee main  && git push gitee vx.y.z     # Gitee
```

推送后必须验证三方同步：

```powershell
git fetch origin --tags -q
git rev-parse --short HEAD origin/main gitee/main vx.y.z
# 前三个应相同
```

---

## 7. GitHub Release

```powershell
cd Z:\VScodeProject\air-icon-launcher
$dir = 'src-tauri\target\release\bundle\nsis'
gh release create vx.y.z `
  "$dir\air-icon-launcher_x.y.z_x64-setup.exe" `
  "$dir\air-icon-launcher_x.y.z_x64-setup.nsis.zip" `
  "$dir\air-icon-launcher_x.y.z_x64-setup.nsis.zip.sig" `
  "latest.json" `
  --title "vx.y.z" --notes-file "release_notes.md"
```

- `gh` 已登录（keyring），scopes 含 `repo`
- 先把更新日志写进 `release_notes.md`，避免命令行转义地狱
- 成功后清理：`Remove-Item release_notes.md`

---

## 8. Gitee Release

**必须用 JSON 文件 + curl**，PowerShell 的 `ConvertTo-Json` 会导致中文乱码。

### 8.1 写 JSON 文件

文件名 `gitee_body.json`（**不要**用 UTF-8 BOM）：

```json
{
  "tag_name": "vx.y.z",
  "name": "vx.y.z",
  "body": "## vx.y.z\n\n### 优化\n- ...",
  "draft": false,
  "prerelease": false,
  "target_commitish": "main"
}
```

### 8.2 创建 release

```powershell
$resp = curl.exe -s -X POST "https://gitee.com/api/v5/repos/air9420/air-icon-launcher/releases" `
  -H "Authorization: token <TOKEN>" `
  -H "Content-Type: application/json; charset=utf-8" `
  --data-binary "@gitee_body.json"
$resp | Out-File "gitee_resp.json" -Encoding utf8
($resp | ConvertFrom-Json).id      # 记下这个 ID
```

### 8.3 上传附件（4 个）

```powershell
$id = <上一步的 ID>
$dir = 'src-tauri\target\release\bundle\nsis'
$files = @(
  "$dir\air-icon-launcher_x.y.z_x64-setup.exe",
  "$dir\air-icon-launcher_x.y.z_x64-setup.nsis.zip",
  "$dir\air-icon-launcher_x.y.z_x64-setup.nsis.zip.sig",
  "latest.json"
)
foreach ($f in $files) {
  $r = curl.exe -s -X POST "https://gitee.com/api/v5/repos/air9420/air-icon-launcher/releases/$id/attach_files" `
    -H "Authorization: token <TOKEN>" -F "file=@$f"
  if ($r -notmatch '"id"') { "FAIL: $f -> $r" } else { "OK: $(Split-Path $f -Leaf)" }
}
```

### 8.4 清理

```powershell
Remove-Item gitee_body.json, gitee_resp.json, release_notes.md -ErrorAction SilentlyContinue
```

---

## 9. 发布后验证

```powershell
# 1) 三方 HEAD 一致
git rev-parse --short HEAD origin/main gitee/main

# 2) 资源可下载（-L 跟随 302 跳转，不加会拿到空内容）
curl.exe -sL --max-time 60 -o NUL -w "%{http_code}`n" `
  "https://github.com/Air9420/air-icon-launcher/releases/download/vx.y.z/latest.json"

# 3) latest.json 内容正确
$j = curl.exe -sL "https://github.com/Air9420/air-icon-launcher/releases/download/vx.y.z/latest.json" | ConvertFrom-Json
$j.version
$j.platforms.'windows-x86_64'.url
$j.platforms.'windows-x86_64'.signature.Length    # 应约 436

# 4) 签名与线上 latest.json 一致（最关键，决定自动更新能否成功）
$sig = (Get-Content "$dir\air-icon-launcher_x.y.z_x64-setup.nsis.zip.sig" -Raw).Trim()
$sig -eq $j.platforms.'windows-x86_64'.signature   # 应为 True
```

> ⚠️ `curl` 不加 `-L` 会停在 302，读到空内容，容易误判为「发布失败」。
> 大文件（5.8MB）下载可能超时返回 `000`，属本地网络问题，不代表资源缺失。

---

## 10. 已知坑位汇总

| 现象 | 原因 | 解法 |
|---|---|---|
| `git push` 卡死无输出 | GCM 弹 GUI 窗口等人点 | `GIT_TERMINAL_PROMPT=0` + `credential.interactive=false` |
| 打包后没有 `.sig` | 没设签名环境变量 | 设 `TAURI_SIGNING_PRIVATE_KEY` / `_PASSWORD` |
| `latest.json` 读到空 | curl 没加 `-L`，停在 302 | 加 `-L` |
| Gitee release 中文乱码 | `ConvertTo-Json` 编码问题 | 写 JSON 文件 + `curl --data-binary @file` |
| 编译报文件占用 | dev 服务还在跑 | 先 `Stop-Process` 掉 `air-icon-launcher.exe` |
| 自动更新提示签名无效 | `latest.json` 里 signature 与 zip 不匹配 | 从 `.nsis.zip.sig` 原样复制，别手改 |
| 新会话 `gh` 未登录 | keyring 与 shell 会话不同 | `gh auth status` 确认，必要时 `gh auth login` |

---

## 11. 待处理的安全风险

### 11.1 `private.key` 已进入版本控制

- 文件：`private.key`（Tauri 更新签名私钥，348 字节）
- 引入提交：`757bd09 chore: 启用更新包生成 createUpdaterArtifacts`
- **已推送到 GitHub 与 Gitee 公开仓库**

**风险**：任何能访问该仓库的人都可以用它签出「合法」的更新包。
配合 `latest.json`，理论上可向现有用户推送恶意更新。

**修复步骤（尚未执行，需用户决策）**：

1. 生成新密钥对
   ```powershell
   bun tauri signer generate -w private-new.key
   ```
2. 新公钥写入 `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
3. 把 `private.key` 从版本控制移除
   ```powershell
   Add-Content .gitignore "private.key"
   git rm --cached private.key
   ```
4. 轮换后旧版本客户端**无法**验证新签名，需要过渡方案
   （保留旧公钥验证一轮，或让用户手动重装）
5. 历史记录中的私钥仍需清理（`git filter-repo`），并强制推送

> 注意：仅 `git rm --cached` 不会从历史中删除，旧提交里仍可翻出私钥。

### 11.2 文档中的明文凭据

本文件历史版本曾包含 Gitee Token 与签名密码明文。
建议改为从环境变量或本地未跟踪文件读取，避免继续扩散。

---

## 12. 关键配置速查

| 项 | 值 / 位置 |
|---|---|
| 仓库根目录 | `Z:\VScodeProject\air-icon-launcher` |
| 签名私钥 | `private.key`（⚠️ 已泄露，见 §11.1） |
| 签名密码 | 见 §4 命令 |
| GitHub | `Air9420/air-icon-launcher` |
| Gitee | `air9420/air-icon-launcher` |
| 产物目录 | `src-tauri\target\release\bundle\nsis\` |
| 更新清单 | `latest.json`（仓库根，随 Release 上传） |
