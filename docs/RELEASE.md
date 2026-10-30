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
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = Read-Host "签名密码" -AsSecureString | ConvertFrom-SecureString -AsPlainText
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content "Z:\VScodeProject\air-icon-launcher\private-new.key" -Raw)
bun tauri build

# 4) 提交 + 打标签
git add -A
git commit -m "chore(release): 发布 x.y.z"
git tag -a vx.y.z -m "Release vx.y.z"

# 5) 推送（关键：helper 必须指定 manager，否则弹窗卡死，见 §6）
#    首次使用先执行一次（仓库级，长期生效）：
#    git config --local credential.helper manager
git push origin main
git push origin vx.y.z
git push gitee main
git push gitee vx.y.z

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

签名密码不再明文写在文档里，改为从环境变量或本地未跟踪文件读取。

```powershell
# 方式一：交互输入（推荐，不落盘）
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = Read-Host "签名密码" -AsSecureString | ConvertFrom-SecureString -AsPlainText

# 方式二：从本地未跟踪文件读取（自行创建 sign_password.txt，已在 .gitignore 覆盖范围内）
# $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content "sign_password.txt" -Raw).Trim()

$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content "Z:\VScodeProject\air-icon-launcher\private-new.key" -Raw)
bun tauri build
```

> ⚠️ 签名私钥为 `private-new.key`（v0.8.1 起启用）。该文件已在 `.gitignore` 中，**必须本地妥善备份**，
> 丢失后将无法再签发更新包。旧的 `private.key` 已弃用（已泄露，见 §11.1）。

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

### 6.1 为什么新会话会卡死 / 弹窗

本机**系统级**配置是 `credential.helper = helper-selector`：

```powershell
git config --system --get-regexp '^credential'
# credential.helper helper-selector
```

`helper-selector` 就是 `git-credential-helper-selector.exe`，它会**弹出「Select a credential helper」GUI 窗口**等人点选。
在 AI 会话 / 非交互 shell 里没人点，于是 `git push` 无限挂起（实测卡满 5 分钟无输出）。

> ⚠️ **关键误区**：`GIT_TERMINAL_PROMPT=0`、`GCM_INTERACTIVE=never`、`credential.interactive=false`
> **都拦不住这个弹窗**——它发生在「选择 helper」阶段，早于任何密码交互。
> 只设这些环境变量会继续弹窗，必须从配置层绕开 selector。

### 6.2 正确做法（仓库级指定 manager）

在仓库里直接把 helper 指定为 `manager`，跳过 selector：

```powershell
cd Z:\VScodeProject\air-icon-launcher
git config --local credential.helper manager
git config --local credential.interactive false
```

验证（应 1 秒内返回 username / password，**不弹窗**）：

```powershell
$env:GIT_TERMINAL_PROMPT = "0"
"protocol=https`nhost=github.com`n`n" | git credential fill
"protocol=https`nhost=gitee.com`n`n"  | git credential fill
```

> 这是本仓库配置，随 `.git/config` 保存，不会被提交，新会话自动生效。

### 6.3 如果仍然弹窗

说明存在更高优先级的配置把 helper 又指回 selector。逐级排查：

```powershell
git config --local  --get-regexp '^credential'
git config --global --get-regexp '^credential'
git config --system --get-regexp '^credential'
```

- `credential.helperselector.selected` 是 selector 记住的选择，**删掉它**：
  `git config --local --unset credential.helperselector.selected`
- 确认 `credential.helper` 最终解析为 `manager` 而非 `helper-selector`

### 6.4 凭证真的缺失时

若 `git credential fill` 返回 `fatal: unable to get password from user`，说明凭证确实没了：

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
git fetch gitee  --tags -q
git rev-parse --short HEAD origin/main gitee/main
# 三个应相同
```

> ⚠️ `gitee/main` 若报 `fatal: Needed a single revision`，说明该远程引用还没拉取到本地，
> 先执行 `git fetch gitee`；必要时用全名 `git rev-parse --short refs/remotes/gitee/main`。

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

> Token 不再明文写在文档里。先设置环境变量：
> ```powershell
> $env:GITEE_TOKEN = Read-Host "Gitee Token" -AsSecureString | ConvertFrom-SecureString -AsPlainText
> ```
> Token 在 https://gitee.com/profile/personal_access_tokens 生成，需 `projects` 权限。

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
  -H "Authorization: token $env:GITEE_TOKEN" `
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
    -H "Authorization: token $env:GITEE_TOKEN" -F "file=@$f"
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
| `git push` 卡死无输出 | `helper-selector` 弹 GUI 窗口等人点 | 仓库级 `git config --local credential.helper manager`（**仅设 `GIT_TERMINAL_PROMPT=0` 无效**，见 §6.1） |
| 弹出「Select a credential helper」窗口 | 系统级 `credential.helper=helper-selector` | 同上；并 `git config --local --unset credential.helperselector.selected` |
| `git credential fill` 报 `unable to get password from user` | 该配置下无可用凭证 | 确认 helper 为 `manager`；仍失败则 `gh auth login` |
| 打包后没有 `.sig` | 没设签名环境变量 | 设 `TAURI_SIGNING_PRIVATE_KEY` / `_PASSWORD` |
| `latest.json` 读到空 | curl 没加 `-L`，停在 302 | 加 `-L` |
| Gitee release 中文乱码 | `ConvertTo-Json` 编码问题 | 写 JSON 文件 + `curl --data-binary @file` |
| 编译报文件占用 | dev 服务还在跑 | 先 `Stop-Process` 掉 `air-icon-launcher.exe` |
| 自动更新提示签名无效 | `latest.json` 里 signature 与 zip 不匹配 | 从 `.nsis.zip.sig` 原样复制，别手改 |
| 新会话 `gh` 未登录 | keyring 与 shell 会话不同 | `gh auth status` 确认，必要时 `gh auth login` |
| `gitee/main` 报 `Needed a single revision` | 该远程引用尚未 fetch | `git fetch gitee` 后再 `rev-parse` |

---

## 11. 安全风险记录

### 11.1 `private.key` 泄露与密钥轮换（已处理）

**事件**：`private.key`（旧签名私钥）曾进入版本控制并推送到 GitHub / Gitee 公开仓库，
引入提交 `757bd09 chore: 启用更新包生成 createUpdaterArtifacts`。

**处理结果（2026-10-30，随 v0.8.1 生效）**：

- ✅ 已轮换密钥对：新密钥 `private-new.key` / `private-new.key.pub`
- ✅ 新公钥已写入 `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
- ✅ 旧私钥 `private.key` 已移出版本控制，`.gitignore` 覆盖 `private.key`、`private-new.key`、`*.key`、`*.key.pub`
- ⚠️ **历史提交中旧私钥仍然存在**（用户决策：不清理历史，接受该风险）

**已知后果**：

| 客户端版本 | 自动更新能力 |
|---|---|
| v0.8.1 及以后 | ✅ 正常，内置新公钥 |
| v0.8.0 及以前 | ❌ 无法验证新签名，需**手动下载重装** |

> 因用户基数小且暂无用户反馈需求，本次**未做过渡版本**（未发双公钥中间版）。
> 旧版本用户升级需手动安装 v0.8.1。

**残留风险（已接受）**：

- 旧私钥在 Git 历史中可被读取，理论上仍能伪造「v0.8.0 及以前」的更新包
- 但新版本客户端只信任新公钥，该伪造包无法影响 v0.8.1+ 用户
- 若未来需要彻底清除，仍需 `git filter-repo` 重写历史 + 强推（会改变所有提交哈希）

**新密钥保管**：

- 私钥：`private-new.key`（本地，已 gitignore，**务必备份**，丢失将无法再签发更新）
- 密码：与旧密钥相同，见 §4 获取方式

### 11.2 文档中的明文凭据（已处理）

本文件历史版本曾包含 Gitee Token 与签名密码明文，且已随仓库推送到公开平台。

- ✅ 签名密码已从本文档移除，改为运行时交互输入（见 §4）
- ✅ Gitee Token 已从本文档移除，改为从环境变量 `GITEE_TOKEN` 读取（见 §8）
- ⚠️ 历史版本中的明文仍存在于 Git 历史（与 §11.1 同属已接受的历史残留）
- ⚠️ 若凭据曾在公开仓库出现，建议在平台重新生成
  - Gitee Token：https://gitee.com/profile/personal_access_tokens

### 11.2 文档中的明文凭据

本文件历史版本曾包含 Gitee Token 与签名密码明文，且已随仓库推送到公开平台。

**处理情况（2026-10-30）**：

- ✅ 签名密码已从本文档移除，改为运行时交互输入（见 §4）
- ✅ Gitee Token 已从本文档移除，改为从环境变量 `GITEE_TOKEN` 读取（见 §8）
- ❌ **历史版本中的明文仍存在于 Git 历史**，与 §11.1 同属历史清理范畴
- ⚠️ 若这些凭据曾在公开仓库出现，应视为已泄露，建议在平台上**重新生成**
  - Gitee Token：https://gitee.com/profile/personal_access_tokens
  - 签名密钥：见 §11.1 轮换步骤

---

## 12. 关键配置速查

| 项 | 值 / 位置 |
|---|---|
| 仓库根目录 | `Z:\VScodeProject\air-icon-launcher` |
| 签名私钥 | `private-new.key`（⚠️ 务必备份；旧的 `private.key` 已弃用且已泄露，见 §11.1） |
| 签名密码 | 运行时输入，见 §4 |
| Gitee Token | 环境变量 `GITEE_TOKEN` |
| GitHub | `Air9420/air-icon-launcher` |
| Gitee | `air9420/air-icon-launcher` |
| 产物目录 | `src-tauri\target\release\bundle\nsis\` |
| 更新清单 | `latest.json`（仓库根，随 Release 上传） |
