# 发布流程（从零到第一个 GitHub Release）

## 0. 先改两个占位符

`package.json` 里的仓库地址现在是占位：

```json
"homepage": "https://github.com/CHANGE_ME/eyerest",
"repository": { "type": "git", "url": "https://github.com/CHANGE_ME/eyerest.git" }
```

把 `CHANGE_ME` 换成你的 GitHub 用户名（或组织名）。同时 `build.appId`（现在是 `com.eyerest.app`）也建议改成你自己的域名倒写，这个值会写进 macOS 的包标识和 Windows 的卸载项，一旦发版改起来很麻烦。

改完顺手把 `README.md` 里出现的仓库链接也换掉。

## 1. 本地确认一次

```bash
npm ci
npm test          # 100 项逻辑 + 50 项主进程联调
npx electron .    # 能不能正常出托盘、点开设置页
```

## 2. 建仓库并推上去

```bash
git init
git add .
git commit -m "chore: initial commit"
git branch -M main
gh repo create eyerest --public --source=. --push   # 没装 gh 就去网页建空仓库，再 git remote add origin ... && git push -u origin main
```

第一次 push 之后，GitHub Actions 里的 **CI** 会自动在 Linux / Windows / macOS 三个系统上跑测试（`.github/workflows/ci.yml`）。三个都绿了再发版。

## 3. 发第一个版本

版本号在 `package.json` 的 `version` 里，现在是 `0.1.0`。

```bash
git tag v0.1.0
git push origin v0.1.0
```

打 tag 会触发 **Release** 工作流（`.github/workflows/release.yml`）：

| 平台 | 产物 |
| --- | --- |
| macOS | `EyeRest-0.1.0-arm64.dmg` / `.zip`（Apple Silicon）、`EyeRest-0.1.0-x64.dmg` / `.zip`（Intel） |
| Windows | `EyeRest Setup 0.1.0.exe`（安装版）、`EyeRest 0.1.0.exe`（免安装单文件） |
| 附加 | `SHA256SUMS.txt` |

整个过程大概 10–15 分钟：mac 两个架构各要下一份 Electron，Windows 还要下 NSIS 打包工具。

发布默认勾了 **prerelease**（首个版本还没在真机上长期跑过）。确认没问题后到 Release 页面把 "Set as a pre-release" 取消勾选即可。

## 4. 没有签名意味着什么

两个平台都没有买证书，所以：

- **macOS**：Gatekeeper 会拦。用户第一次要**右键 → 打开**，或者到「系统设置 → 隐私与安全性」点「仍要打开」。如果提示「已损坏，无法打开」，让他执行 `xattr -cr /Applications/EyeRest.app`（因为从网上下载的包带 quarantine 属性）。
  想彻底消掉这个提示需要 Apple Developer（99 美元/年）签名 + 公证（notarization），在 `build.mac` 里加 `notarize` 并配 `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` 三个 secrets。
- **Windows**：SmartScreen 会提示「未知发布者」→「更多信息」→「仍要运行」。要消掉需要 OV/EV 代码签名证书。

这些不影响功能，只是首次打开多两步。README 和 Release 说明里都写了。

## 5. 本地自己打包（可选）

CI 已经能出全平台包，本地打包只用于验证配置对不对：

```bash
npm run dist:mac     # 只能在 macOS 上跑
npm run dist:win     # 只能在 Windows 上跑（或 wine，不推荐）
npm run dist:linux   # 只能在 Linux 上跑
```

产物在 `dist/`。electron-builder **不能跨平台出包**（mac 包必须在 mac 上构建，Windows 同理），这也是为什么用 GitHub Actions 的 macOS 和 Windows runner，而不是在本地硬造。

## 6. 版本号怎么往下走

- 改功能 → `0.2.0`，修 bug → `0.1.1`；
- 改版本号 + commit + 打新 tag，就是一次发布；
- `CHANGELOG.md` 记得同步补一行（首版已经写好模板）。
