# 一个小工具：可靠地启动一个 exe、等到它退出、拿到退出码和完整输出。
# PowerShell 自带的 Start-Process -PassThru 对 GUI 程序经常拿不到 ExitCode，
# 这里直接用 .NET 的 Process，稳定得多。

function Invoke-Exe {
  param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [string[]]$Arguments = @(),
    [string]$WorkingDir = '',
    [int]$TimeoutSec = 30
  )

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $Exe
  if ($Arguments.Count -gt 0) { $psi.Arguments = ($Arguments -join ' ') }
  if ($WorkingDir -ne '') { $psi.WorkingDirectory = $WorkingDir }
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true

  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi

  try {
    [void]$proc.Start()
  } catch {
    return [pscustomobject]@{
      Code = $null; StillRunning = $false; Out = ''; Err = "启动失败：$($_.Exception.Message)"
    }
  }

  $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
  $stderrTask = $proc.StandardError.ReadToEndAsync()
  $exited = $proc.WaitForExit($TimeoutSec * 1000)

  if (-not $exited) {
    try { $proc.Kill() } catch {}
    Start-Sleep -Milliseconds 300
    return [pscustomobject]@{
      Code = $null; StillRunning = $true; Out = ''; Err = ''
    }
  }

  try { [void]$stdoutTask.Wait(2000) } catch {}
  try { [void]$stderrTask.Wait(2000) } catch {}

  $code = $null
  try { $code = $proc.ExitCode } catch {}

  $out = ''
  $err = ''
  try { $out = $stdoutTask.Result } catch {}
  try { $err = $stderrTask.Result } catch {}

  [pscustomobject]@{
    Code = $code; StillRunning = $false; Out = $out; Err = $err
  }
}

function Show-Tail {
  param([string]$Text, [string]$Title, [int]$MaxLines = 25)
  if ([string]::IsNullOrWhiteSpace($Text)) { return }
  $all = $Text -split "`r?`n" | Where-Object { $_.Trim() -ne '' }
  if (-not $all) { return }
  Write-Host "  ---- $Title ----"
  $tail = $all | Select-Object -Last $MaxLines
  foreach ($line in $tail) { Write-Host "  | $line" }
}

# Electron 的运行时（electron.exe + 那堆 .dll/.pak）不能放在
# D:\Workspace\tools 这类被沙箱改过 ACL 的目录里 —— Chromium 启动早期
# 会对自己所在目录做一次访问，被那条 Everyone 继承拒绝项挡住，直接
# CHECK 失败（退出码 -2147483645 / 0x80000003）。
# 所以这里把 dist 复制一份到 %LOCALAPPDATA%\EyeRecess\runtime 再跑。
function Get-ElectronExe {
  param([string]$Proj)

  $srcDist = Join-Path $Proj 'node_modules\electron\dist'
  $srcExe = Join-Path $srcDist 'electron.exe'
  if (-not (Test-Path $srcExe)) { return $null }

  $runtimeDir = Join-Path $env:LOCALAPPDATA 'EyeRecess\runtime'
  $runtimeExe = Join-Path $runtimeDir 'electron.exe'

  $needCopy = $true
  if (Test-Path $runtimeExe) {
    $a = (Get-Item $runtimeExe).Length
    $b = (Get-Item $srcExe).Length
    $needCopy = ($a -ne $b)
  }

  if ($needCopy) {
    Write-Host "  首次运行：正在把 Electron 运行时复制到 $runtimeDir ..."
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
    $null = robocopy $srcDist $runtimeDir /E /NFL /NDL /NJH /NJS /NP
    # robocopy 0-7 都算成功
    if ($LASTEXITCODE -gt 7) { Write-Host "  复制好像没完全成功（robocopy 退出码 $LASTEXITCODE）" }
  }

  if (Test-Path $runtimeExe) { return $runtimeExe }
  return $srcExe
}

function Write-RunLog {
  param([string]$Path, [string]$Text)
  [System.IO.File]::AppendAllText($Path, $Text + "`r`n", (New-Object System.Text.UTF8Encoding($false)))
}
