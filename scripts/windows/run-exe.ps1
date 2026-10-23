# Shared process execution and local runtime preparation.

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
      Code = $null; StillRunning = $false; Out = ''; Err = "Process start failed: $($_.Exception.Message)"
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

function Get-ElectronExe {
  param([string]$Proj)

  $srcDist = Join-Path $Proj 'node_modules\electron\dist'
  $srcExe = Join-Path $srcDist 'electron.exe'
  if (-not (Test-Path $srcExe)) { return $null }

  # Run outside restricted workspaces to avoid executable-directory ACL issues.
  $runtimeDir = Join-Path $env:LOCALAPPDATA 'EyeRecess\runtime'
  $runtimeExe = Join-Path $runtimeDir 'electron.exe'

  $needCopy = $true
  if (Test-Path $runtimeExe) {
    $a = (Get-Item $runtimeExe).Length
    $b = (Get-Item $srcExe).Length
    $needCopy = ($a -ne $b)
  }

  if ($needCopy) {
    Write-Host "Preparing the local Electron runtime..."
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
    $null = robocopy $srcDist $runtimeDir /E /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -gt 7) { Write-Host "Runtime copy may be incomplete (robocopy exit code $LASTEXITCODE)." }
  }

  if (Test-Path $runtimeExe) { return $runtimeExe }
  return $srcExe
}

function Write-RunLog {
  param([string]$Path, [string]$Text)
  [System.IO.File]::AppendAllText($Path, $Text + "`r`n", (New-Object System.Text.UTF8Encoding($false)))
}
