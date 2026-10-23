# Produce a local readiness report. No environment values or raw logs are collected.
$ErrorActionPreference = 'Continue'
$proj = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$logsDir = Join-Path $proj 'logs'
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
$report = Join-Path $logsDir 'diagnostics.txt'
$lines = New-Object System.Collections.Generic.List[string]

function Say([string]$Text) {
  $lines.Add($Text) | Out-Null
  Write-Host $Text
}

Say 'EyeRecess readiness report'
Say ("Generated: {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Say ("PowerShell: {0}" -f $PSVersionTable.PSVersion)
Say ("Architecture: {0}" -f $env:PROCESSOR_ARCHITECTURE)
try {
  $pkg = Get-Content (Join-Path $proj 'package.json') -Raw | ConvertFrom-Json
  Say ("Application version: {0}" -f $pkg.version)
} catch {
  Say 'Application metadata: unavailable'
}
try {
  $node = & node --version 2>$null
  Say ("Node: {0}" -f $node)
} catch {
  Say 'Node: unavailable'
}

foreach ($name in @('ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS')) {
  $present = -not [string]::IsNullOrEmpty([System.Environment]::GetEnvironmentVariable($name, 'Process'))
  Say ("Environment flag {0} is set: {1}" -f $name, $present)
}

foreach ($relative in @(
  'package.json',
  'node_modules\electron\dist\electron.exe',
  'src\main\main.js',
  'src\preload\settings.js',
  'src\renderer\settings\index.html',
  'assets\tray-idle.png'
)) {
  Say ("Required file {0}: {1}" -f $relative, (Test-Path (Join-Path $proj $relative)))
}

Say 'No application processes were started or stopped by this report.'
Say 'For a desktop smoke check, run npm run smoke separately.'
Say 'Review report contents before sharing. No report is uploaded automatically.'
$lines -join "`r`n" | Set-Content -Path $report -Encoding UTF8
Write-Host 'Report saved to logs\diagnostics.txt.'
