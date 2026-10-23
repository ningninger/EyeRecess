# EyeRecess 自检脚本 —— 双击 diagnose.cmd 运行。
# 它不会改动任何东西，只是把「为什么起不来」需要的信息收集到《诊断报告.txt》。
# 注意：本文件必须保存成 UTF-8 with BOM + CRLF，否则 Windows PowerShell 5.1 会把中文读成乱码。

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'run-exe.ps1')

$proj = Split-Path -Parent $PSScriptRoot
$report = Join-Path $proj '诊断报告.txt'
$lines = New-Object System.Collections.Generic.List[string]

function Say([string]$text = '') {
  $lines.Add($text) | Out-Null
  Write-Host $text
}

function Head([string]$title) {
  Say ''
  Say ('=' * 68)
  Say "  $title"
  Say ('=' * 68)
}

function TryGet([scriptblock]$block, [string]$label = '') {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Stop'
  try {
    & $block
  } catch {
    if ($label) { Say "  <$label 取不到：$($_.Exception.Message)>" } else { Say "  <取不到：$($_.Exception.Message)>" }
  } finally {
    $ErrorActionPreference = $prev
  }
}

function SayBlock([string]$text, [int]$maxLines = 40, [string]$prefix = '  | ') {
  if ([string]::IsNullOrWhiteSpace($text)) { Say '  (空)'; return }
  $all = $text -split "`r?`n" | Where-Object { $_.Trim() -ne '' } | Select-Object -First $maxLines
  foreach ($line in $all) { Say ($prefix + $line) }
}

Say 'EyeRecess 诊断报告'
Say "生成时间：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Say "项目目录：$proj"
Say '（这次运行会花 40 秒左右，中途可能弹出一个最小窗口，那是自检用的，会自动关掉）'

# ---------------------------------------------------------------- 环境
Head '1. 系统与运行时'
TryGet { Say "  操作系统：$([System.Environment]::OSVersion.VersionString)" }
TryGet { Say "  架构：$env:PROCESSOR_ARCHITECTURE" }
TryGet {
  $cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
  Say "  系统版本：$($cv.ProductName) $($cv.DisplayVersion) build $($cv.CurrentBuild).$($cv.UBR)"
}
TryGet {
  $node = & node -v 2>$null
  Say "  Node：$node（$((Get-Command node -ErrorAction SilentlyContinue).Source)）"
} 'node'
TryGet { Say "  PowerShell：$($PSVersionTable.PSVersion)" }

Head '2. 可能干扰启动的环境变量'
foreach ($name in @('ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ATTACH_CONSOLE', 'ELECTRON_ENABLE_LOGGING', 'NODE_OPTIONS')) {
  $v = [System.Environment]::GetEnvironmentVariable($name, 'Process')
  $u = [System.Environment]::GetEnvironmentVariable($name, 'User')
  $m = [System.Environment]::GetEnvironmentVariable($name, 'Machine')
  Say ("  {0,-28} 当前进程=[{1}] 用户=[{2}] 机器=[{3}]" -f $name, $v, $u, $m)
}
Say '  * ELECTRON_RUN_AS_NODE 有值的话，Electron 会被当成普通 Node 跑，窗口一闪就没。'

# ---------------------------------------------------------------- 文件
Head '3. 程序文件是否完整'
$pkg = Join-Path $proj 'package.json'
Say "  package.json：$(if (Test-Path $pkg) { '存在' } else { '缺失（文件不全）' })"
$dist = Join-Path $proj 'node_modules\electron\dist'
$distExe = Join-Path $dist 'electron.exe'
$exe = Get-ElectronExe -Proj $proj
Say ("  实际运行时：{0}" -f $exe)
Say '  * Electron 运行时会被复制到 %LOCALAPPDATA%\EyeRecess\runtime 再启动。'
Say '    原因：这个工作区目录的 ACL 里有一条 Everyone 的继承拒绝项，Chromium 在这种目录里会直接崩。'
if (Test-Path $distExe) {
  $f = Get-Item $distExe
  Say ("  electron.exe：存在，{0:N1} MB，版本 {1}" -f ($f.Length / 1MB), $f.VersionInfo.FileVersion)
} else {
  Say '  electron.exe：不存在 —— 依赖没装好，先 npm install'
}
$ptxt = Join-Path $proj 'node_modules\electron\path.txt'
Say "  path.txt：$(if (Test-Path $ptxt) { (Get-Content $ptxt -Raw).Trim() } else { '缺失（electron 会尝试自己下载，通常卡住）' })"
foreach ($sub in @('src\main\main.js', 'src\main\log.js', 'src\preload\overlay.js', 'src\renderer\settings\index.html', 'assets\tray-idle.png')) {
  $p = Join-Path $proj $sub
  Say ("  {0,-36} {1}" -f $sub, $(if (Test-Path $p) { 'OK' } else { '缺失' }))
}

# ---------------------------------------------------------------- 既有日志
Head '4. 上一次运行留下的日志'
$projLog = Join-Path $proj 'logs\eyerecess.log'
$logPath = if (Test-Path $projLog) { $projLog } else { Join-Path $env:APPDATA 'EyeRecess\logs\eyerecess.log' }
if (Test-Path $logPath) {
  Say "  日志文件：$logPath"
  Say "  大小：$((Get-Item $logPath).Length) 字节，最后修改：$((Get-Item $logPath).LastWriteTime)"
  Say '  ---- 最后 40 行 ----'
  $tail = Get-Content $logPath -Tail 40 -Encoding UTF8 -ErrorAction SilentlyContinue
  foreach ($line in $tail) { Say "  | $line" }
} else {
  Say "  没有日志文件（$logPath）"
  Say '  说明程序连第一行 JS 都没跑到，或者根本没被真正启动 —— 这本身就是重要线索。'
}

$env:ELECTRON_RUN_AS_NODE = ''

# ---------------------------------------------------------------- 最小 Electron
Head '5. 最小 Electron 窗口（判断是 Electron 坏了还是我们程序坏了）'
$mini = Join-Path $env:TEMP ('eyerecess-mini-' + [guid]::NewGuid().ToString('N').Substring(0, 6))
try {
  New-Item -ItemType Directory -Force -Path $mini | Out-Null
  $miniJs = @'
const { app, BrowserWindow } = require('electron');
console.log('MINI-BOOT electron=' + process.versions.electron + ' node=' + process.versions.node);
app.whenReady().then(() => {
  console.log('MINI-READY');
  const w = new BrowserWindow({ width: 460, height: 240, title: 'EyeRecess selfcheck' });
  w.loadURL('data:text/html,<body style="font:16px system-ui;padding:24px">Electron OK</body>');
  setTimeout(() => { console.log('MINI-QUIT'); app.exit(0); }, 5000);
}).catch((e) => { console.log('MINI-ERROR ' + e.message); app.exit(3); });
'@
  Set-Content -Path (Join-Path $mini 'main.js') -Value $miniJs -Encoding UTF8
  Say "  临时目录：$mini"
  if (Test-Path $exe) {
    $r = Invoke-Exe -Exe $exe -Arguments @((Join-Path $mini 'main.js')) -WorkingDir $mini -TimeoutSec 20
    if ($r.StillRunning) {
      Say '  20 秒没退出（强制结束），说明窗口卡住了'
    } else {
      Say ("  退出码：{0}" -f $r.Code)
    }
    Say '  ---- stdout ----'
    SayBlock $r.Out
    Say '  ---- stderr ----'
    SayBlock $r.Err
  } else {
    Say '  跳过：electron.exe 不存在'
  }
} catch {
  Say "  最小窗口测试本身出错了：$($_.Exception.Message)"
} finally {
  Remove-Item -Recurse -Force $mini -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------- --smoke
Head '6. EyeRecess 冒烟测试（--smoke，会自己退出）'
if (Test-Path $exe) {
  $r = Invoke-Exe -Exe $exe -Arguments @('.', '--smoke') -WorkingDir $proj -TimeoutSec 25
  if ($r.StillRunning) {
    Say '  25 秒没退出（强制结束）—— 说明初始化卡住了'
  } else {
    Say ("  退出码：{0}" -f $r.Code)
  }
  Say '  ---- stdout ----'
  SayBlock $r.Out
  Say '  ---- stderr ----'
  SayBlock $r.Err
}

# ---------------------------------------------------------------- 正常启动
Head '7. 正常启动 10 秒（看它会不会活下来）'
if (Test-Path $exe) {
  $clog = Join-Path $proj 'chromium.log'
  Remove-Item $clog -ErrorAction SilentlyContinue
  $r = Invoke-Exe -Exe $exe -Arguments @('.', '--enable-logging=file', "--log-file=$clog") -WorkingDir $proj -TimeoutSec 10
  if ($r.StillRunning) {
    Say '  10 秒后进程还活着 —— GUI 起得来，问题多半是托盘图标被折叠/隐藏了'
    Say '  已强制结束，避免留后台进程'
  } else {
    Say ("  10 秒内就退出了，退出码：{0}" -f $r.Code)
  }
  Say '  ---- stdout ----'
  SayBlock $r.Out 30
  Say '  ---- stderr ----'
  SayBlock $r.Err 30
  if (Test-Path $clog) {
    Say '  ---- Chromium 日志（最后 30 行）----'
    $ct = Get-Content $clog -Tail 30 -ErrorAction SilentlyContinue
    foreach ($line in $ct) { Say "  | $line" }
  }
}

# ---------------------------------------------------------------- 事件日志
Head '8. Windows 事件查看器里的崩溃记录（最近 30 分钟）'
TryGet {
  $since = (Get-Date).AddMinutes(-30)
  $evts = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $since } -ErrorAction SilentlyContinue |
    Where-Object { $_.Id -in 1000, 1001, 1026 } |
    Where-Object { $_.Message -match 'electron|EyeRecess' } |
    Select-Object -First 4
  if (-not $evts) {
    Say '  最近 30 分钟没有相关崩溃记录（说明不是异常崩溃，而是干净地退出了）'
  } else {
    foreach ($e in $evts) {
      Say "  --- $($e.TimeCreated) Id=$($e.Id) ---"
      ($e.Message -split "`n" | Select-Object -First 12) | ForEach-Object { Say "  | $($_.TrimEnd())" }
    }
  }
} '事件日志'

# ---------------------------------------------------------------- 写盘
Head '9. 结束'
$lines -join "`r`n" | Set-Content -Path $report -Encoding UTF8
Write-Host ''
Write-Host '报告已写入：' -ForegroundColor Green
Write-Host "  $report" -ForegroundColor Green
Write-Host ''
Write-Host '按回车关闭窗口。' -ForegroundColor Green
