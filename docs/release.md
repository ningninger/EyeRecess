# 发布流程（从零到第一个 GitHub Release）

## 0. 占位符已经填好了

`package.json` 里的仓库地址已经填成 `ningninger/eyerecess`：

```json
"homepage": "https://github.com/ningninger/eyerecess",
"repository": { "type": "git", "url": "https://github.com/ningninger/eyerecess.git" }
```

如果要换成别的用户名或组织名，改上面两行再提交一次即可。`build.appId`（现在是 `com.eyerecess.app`）也可以改成自己的域名倒写——它会写进 macOS 的包标识和 Windows 的卸载项，发版之后再改比较麻烦，首版前定好更省事。

## 1. 本地确认一次

```bash
npm ci
npm test          # 100 项逻辑 + 50 项主进程联调
npx electron .    # 能不能正常出托盘、点开设置页
```

## 2. 建远程仓库并推上去

这个目录**已经 `git init` 并提交好了**（`git log` 能看到 `EyeRecess 0.1.0`），远程也配好了（`git remote -v` 有 `origin`，走 SSH），只差 GitHub 上那个空仓库：

1. 打开 <https://github.com/new>，仓库名填 `eyerecess`，**不要**勾 "Add a README"、".gitignore"、"license"（要空的）；
2. 回到这个目录执行：

```bash
git push -u origin main
```

这台机器的 SSH key 已经能登 GitHub（`ssh -T git@github.com` 返回 `Hi ningninger!`），所以不用再配 token。

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
| macOS | `EyeRecess-0.1.0-arm64.dmg` / `-arm64.zip`（Apple Silicon）、`EyeRecess-0.1.0-x64.dmg` / `-x64.zip`（Intel） |
| Windows | `EyeRecess Setup 0.1.0.exe`（安装版，可选安装目录）、`EyeRecess-0.1.0-win.zip`（免安装，解压出 `EyeRecess.exe` 直接跑） |
| 附加 | `SHA256SUMS.txt` |

整个过程大概 10–15 分钟：mac 两个架构各要下一份 Electron，Windows 还要下 NSIS 打包工具。

发布默认勾了 **prerelease**（首个版本还没在真机上长期跑过）。确认没问题后到 Release 页面把 "Set as a pre-release" 取消勾选即可。

## 4. 没有签名意味着什么

两个平台都没有买证书，所以：

- **macOS**：Gatekeeper 会拦。用户第一次要**右键 → 打开**，或者到「系统设置 → 隐私与安全性」点「仍要打开」。如果提示「已损坏，无法打开」，让他执行 `xattr -cr /Applications/EyeRecess.app`（因为从网上下载的包带 quarantine 属性）。
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

### 在这台 Windows 机器上的已知限制

- **NSIS 安装包在本机打不出来**：`Error in script "<stdin>" on line 117` / `!tempfile: Unable to create temporary file!`。原因是工作区目录带着 DSH 沙箱的继承拒绝项（`(D;CI;DT;;;WD)`），makensis 建临时文件被拒。**跟配置无关**，GitHub Actions 的干净 runner 上正常。
- 本机能打的是 zip 目标，已经实测过：

  ```bash
  npx electron-builder --win zip --x64
  # → dist\EyeRecess-0.1.0-win.zip（146 MB）
  ```

  解压出来 `win-unpacked\EyeRecess.exe` 可以直接双击运行，asar 打包、图标、托盘、安全策略都验证过没问题。

## 6. 版本号怎么往下走

- 改功能 → `0.2.0`，修 bug → `0.1.1`；
- 改版本号 + commit + 打新 tag，就是一次发布；
- `CHANGELOG.md` 记得同步补一行（首版已经写好模板）。
