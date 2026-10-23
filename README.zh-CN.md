# EyeRecess（课间）

一个常驻菜单栏或系统托盘的休息提醒工具。根据电脑活跃使用情况，适时提醒你闭眼、眨眼、远眺和起身。

[English](README.md)

## 安装与使用

从 [Releases](https://github.com/ningninger/eyerecess/releases) 下载：

- **macOS**：Apple Silicon 选择 `arm64.dmg`，Intel 选择 `x64.dmg`。
- **Windows**：选择安装版或免安装版。
- **Linux**：目前需要从源码运行或自行构建。

当前版本尚未签名，首次运行可能出现系统提示。启动后，点击菜单栏或托盘图标打开「设置」。关闭设置窗口后应用仍会运行，退出请使用菜单中的「退出」。

**普通用户无需安装开发依赖。** 安装版和免安装版已包含 Electron 运行环境，无需另装 Node.js、npm 或 Electron。请下载对应平台的应用文件；GitHub 的「Source code」压缩包是源码，不能直接当作应用运行。

如果从源码运行，需要先安装 Node.js 22.12.0 或更新版本，在项目根目录执行 `npm ci`，再执行 `npm start`。首次安装依赖需要联网，之后应用可离线使用。如果已经执行过 `npm ci`，但仍提示缺少 Electron，请执行 `npm run setup:electron` 下载运行程序，再执行 `npm start`。后续执行 `npm ci` 会自动完成这一步；不要跳过安装脚本。

如果下载时提示 `fetch failed`，说明 Electron 运行程序尚未安装完成；npm 包安装成功并不代表能访问运行程序下载地址。可按[下载故障处理](docs/support.md#electron-download-failures)配置代理或选择镜像，安装成功后再启动。

## 主要功能

- 默认即可使用，也可选择方案、分别开关提醒并调整节奏。
- 展开设置即可调整休息步骤、时长与提示语，支持恢复推荐方案。
- 闭眼、眨眼、起身与远眺引导。
- 勿扰时段、暂停和会议期间的轻提醒。
- 本地保存设置与每日使用统计，无需账号或云同步。

计时依据键鼠活跃程度估算，并不能判断实际注视；被动阅读可能被视为空闲。会议检测也可能误判。此工具用于帮助建立休息习惯，不用于诊断或治疗。

登录后自动启动仅适用于已打包的 macOS 和 Windows 应用。Linux Wayland 下的遮罩、置顶和全局快捷键存在限制，详见[平台兼容性](docs/compatibility.md)。权限与本地存储边界见[安全说明](docs/security.md)。

开发文档、代码注释和工程规范统一使用英文，详见 [Contributing](CONTRIBUTING.md)。

[MIT 许可](LICENSE)
