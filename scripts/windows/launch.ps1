# Start EyeRecess from a source checkout. Keep UTF-8 BOM and CRLF.
param(
  [switch]$Smoke,
  [switch]$Quiet
)

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'run-exe.ps1')
$proj = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $proj

$logsDir = Join-Path $proj 'logs'
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$runLog = Join-Path $logsDir ("launch-{0}.log" -f $stamp)
$chromiumLog = Join-Path $logsDir 'chromium-last.log'

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

Line ("EyeRecess launcher: {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
# The GUI runtime must not inherit Node execution mode.
$env:ELECTRON_RUN_AS_NODE = ''
$env:EYERECESS_LOG_DIR = $logsDir
$exe = Get-ElectronExe -Proj $proj
if (-not $exe) {
  $message = 'The Electron runtime is missing or incomplete. For source use, install Node.js 22.12.0 or later and run npm ci in the project folder, then try again. If npm packages are already installed, run npm run setup:electron. For normal use, download the installer or portable build from https://github.com/ningninger/eyerecess/releases; it includes the runtime and needs no Node.js installation.'
  Line $message
  if ($Quiet) {
    try {
      $popup = New-Object -ComObject WScript.Shell
      [void]$popup.Popup($message, 0, 'EyeRecess setup required', 48)
    } catch {
      Write-Warning 'Could not show setup instructions. Run run-windows.cmd for details.'
    }
  }
  exit 1
}

$argsList = @($proj)
if ($Smoke) { $argsList += '--smoke' }
$argsList += '--enable-logging=file'
$argsList += ("--log-file=" + $chromiumLog)

if (-not $Smoke -and -not $Quiet) {
  Line 'Starting EyeRecess. Look for the tray icon, including the overflow area.'
  Line 'Use the tray menu to open Settings or Quit.'
}

if ($Quiet) {
  # Observe startup briefly without retaining a launcher process for the app lifetime.
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

if ($r.StillRunning) {
  Line 'The application remains running.'
} else {
  Line ("Application exit code: {0}" -f $r.Code)
}
if (-not [string]::IsNullOrWhiteSpace($r.Out)) {
  Line 'Application output:'
  foreach ($l in ($r.Out -split "`r?`n")) { if ($l.Trim() -ne '') { Line ("  | " + $l) } }
}
if (-not [string]::IsNullOrWhiteSpace($r.Err)) {
  Line 'Application errors:'
  foreach ($l in ($r.Err -split "`r?`n")) { if ($l.Trim() -ne '') { Line ("  | " + $l) } }
}

if (-not $r.StillRunning -and $r.Code -eq 3) {
  Line 'Another EyeRecess instance is already running. Check the tray menu.'
} elseif (-not $r.StillRunning -and $r.Code -ne 0) {
  Line 'Startup failed. Inspect local logs and share only reviewed, relevant excerpts.'
}
Line 'Launcher and application logs are stored in the checkout logs directory.'

if ($Quiet -and -not $r.StillRunning -and $r.Code -ne 0) {
  try {
    Add-Type -AssemblyName System.Windows.Forms | Out-Null
    $msg = "EyeRecess could not start (exit code $($r.Code)).`n`nSee the local logs directory for details. Review logs before sharing them."
    [System.Windows.Forms.MessageBox]::Show($msg, 'EyeRecess startup failed', 'OK', 'Warning') | Out-Null
  } catch { }
}
