# EyeRecess 启动器（由 run-windows.cmd 调用，不要直接双击本文件）
# 本文件必须是 UTF-8 with BOM + CRLF，否则 Windows PowerShell 5.1 会把中文读成乱码。
#
# 这个脚本做四件事：
#   1. 把 Electron 运行时复制到 %LOCALAPPDATA%\EyeRecess\runtime（工作区目录的 ACL 有问题，
#      Chromium 在那棵树里启动会直接 CHECK 失败，详见 run-exe.ps1 的说明）
#   2. 启动 App，等它退出，拿到真实退出码
#   3. 把这次运行的完整信息同时打印到屏幕、写进 logs\launch-*.log
#   4. 把 App 自己的日志也定向到 logs\ 目录，方便事后排查

param(
  [switch]$Smoke,
  [switch]$Quiet   # 静默模式：不往控制台打印，失败时弹一个对话框
)

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'run-exe.ps1')

$proj = Split-Path -Parent $PSScriptRoot
Set-Location $proj

$logsDir = Join-Path $proj 'logs'
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$runLog = Join-Path $logsDir ("launch-{0}.log" -f $stamp)
$appLog = Join-Path $logsDir 'eyerecess.log'
$chromiumLog = Join-Path $logsDir 'chromium-last.log'

# 只留最近 20 份运行日志
Get-ChildItem $logsDir -Filter 'launch-*.log' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip 20 |
  Remove-Item -Force -ErrorAction SilentlyContinue

Remove-Item $chromiumLog -Force -ErrorAction SilentlyContinue

function Line {
  param([string]$Text = '')
  if (-not $Quiet) { Write-Host $Text }
  try { Write-RunLog -Path $runLog -Text $Text } catch { }
}

Line '=========================================================='
Line ("EyeRecess 启动记录  {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Line ("项目目录:   {0}" -f $proj)
Line ("PowerShell: {0}" -f $PSVersionTable.PSVersion)
Line '=========================================================='

# 某些环境会把 ELECTRON_RUN_AS_NODE 设成 1，那会让 Electron 退化成普通 Node，
# 表现就是「什么窗口都没有」。
$env:ELECTRON_RUN_AS_NODE = ''

# 让 App 自己的日志也落到项目里
$env:EYERECESS_LOG_DIR = $logsDir

$exe = Get-ElectronExe -Proj $proj
if (-not $exe) {
  Line ''
  Line '  [EyeRecess] 还没有安装依赖。请先在这个目录里执行：'
  Line ''
  Line '      npm install'
  Line ''
  exit 1
}
Line ("运行时:     {0}" -f $exe)

$argsList = @($proj)
if ($Smoke) { $argsList += '--smoke' }
$argsList += '--enable-logging=file'
$argsList += ("--log-file=" + $chromiumLog)
Line ("参数:       {0}" -f ($argsList -join ' '))
Line ''

if (-not $Smoke -and -not $Quiet) {
  Line '  [EyeRecess] 正在启动……'
  Line '  图标会出现在右下角的系统托盘（蓝色圆环），可能被收在向上箭头 ^ 的折叠区里。'
  Line '  这个窗口保持打开时程序才在运行；要退出请用托盘菜单里的「退出」。'
  Line ''
}

if ($Quiet) {
  # 静默模式：只等 25 秒。25 秒还活着就说明托盘已经起来了，PowerShell 立刻退出，
  # 不在后台一直挂着等用户关程序。
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  $psi.WorkingDirectory = $proj
  $psi.UseShellExecute = $false
  $psi.Arguments = (($argsList | ForEach-Object {
    if ($_ -match '\s') { '"' + $_ + '"' } else { $_ }
  }) -join ' ')
  $proc = [System.Diagnostics.Process]::Start($psi)
  if ($proc.WaitForExit(25000)) {
    $r = [pscustomobject]@{ StillRunning = $false; Code = $proc.ExitCode; Out = ''; Err = '' }
  } else {
    $r = [pscustomobject]@{ StillRunning = $true; Code = $null; Out = ''; Err = '' }
  }
} else {
  $r = Invoke-Exe -Exe $exe -Arguments $argsList -WorkingDir $proj -TimeoutSec 604800
}

Line ''
Line '=========================================================='
if ($r.StillRunning) {
  Line '  程序还在运行（被超时打断）'
} else {
  Line ("  程序已退出，退出码 {0}" -f $r.Code)
}
Line '=========================================================='

if (-not [string]::IsNullOrWhiteSpace($r.Out)) {
  Line '---- 标准输出 ----'
  foreach ($l in ($r.Out -split "`r?`n")) { if ($l.Trim() -ne '') { Line ("  | " + $l) } }
}
if (-not [string]::IsNullOrWhiteSpace($r.Err)) {
  Line '---- 错误输出 ----'
  foreach ($l in ($r.Err -split "`r?`n")) { if ($l.Trim() -ne '') { Line ("  | " + $l) } }
}

if (Test-Path $appLog) {
  Line '---- 应用日志（最后 40 行）----'
  Get-Content $appLog -Tail 40 -Encoding UTF8 -ErrorAction SilentlyContinue | ForEach-Object { Line ("  | " + $_) }
} else {
  Line '---- 应用日志：不存在 ----'
  Line ("  说明程序连第一行 JS 都没跑到。应有位置: {0}" -f $appLog)
}

if (Test-Path $chromiumLog) {
  $cl = Get-Content $chromiumLog -Tail 15 -Encoding UTF8 -ErrorAction SilentlyContinue
  if ($cl) {
    Line '---- Chromium 日志（最后 15 行）----'
    foreach ($l in $cl) { Line ("  | " + $l) }
  }
}

function Test-CrashCode {
  param([object]$Code)
  if ($null -eq $Code) { return $false }
  $c = [int64]$Code
  if ($c -lt 0) { return $true }
  if ($c -ge 0xC0000000) { return $true }
  return $false
}

Line ''
if ($r.StillRunning) {
  Line '  [结论] 程序一直在运行 —— 其实已经启动成功，只是图标可能被折叠/隐藏了。'
  Line '         看点右下角的 ^ 箭头，或用托盘菜单里的「设置」。'
} elseif ($r.Code -eq 0) {
  Line '  [结论] 正常退出。'
} elseif ($r.Code -eq 1) {
  Line '  [结论] 进程以 1 退出，通常是 JS 启动阶段抛错，看上面的应用日志。'
} elseif ($r.Code -eq 2) {
  Line '  [结论] Electron 被当成普通 Node 执行了（ELECTRON_RUN_AS_NODE 之类的问题）。'
} elseif ($r.Code -eq 3) {
  Line '  [结论] 已经有另一个 EyeRecess 在跑。任务管理器 →「详细信息」→ 结束所有 electron.exe 再重试。'
} elseif ($r.Code -eq -2147483645) {
  Line '  [结论] Electron 在原生初始化阶段就崩了（Chromium CHECK 失败 / STATUS_BREAKPOINT）。'
  Line '         这几乎总是「运行时所在目录的权限有问题」，请把 logs 目录整个发出来。'
} elseif (Test-CrashCode $r.Code) {
  Line '  [结论] 崩溃退出。请把 logs 目录整个发出来。'
} else {
  Line '  [结论] 非正常退出。请把 logs 目录整个发出来。'
}
Line ''
Line ("本次日志: {0}" -f $runLog)

# 静默模式下如果没跑起来，弹个框告诉用户日志在哪（不然用户什么也看不到）
if ($Quiet -and -not $r.StillRunning -and $r.Code -ne 0) {
  try {
    Add-Type -AssemblyName System.Windows.Forms | Out-Null
    $msg = "EyeRecess 没能正常启动（退出码 $($r.Code)）。`n`n诊断信息已经写进：`n$runLog`n`n把 logs 文件夹整个发出来就能定位问题。"
    [System.Windows.Forms.MessageBox]::Show($msg, 'EyeRecess 启动失败', 'OK', 'Warning') | Out-Null
  } catch { }
}
