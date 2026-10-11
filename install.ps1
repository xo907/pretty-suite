# Sets Pretty Suite up on Windows: asks where to keep things, builds it, and can start it when you log in.
#
#   .\install.ps1                     ask a few questions
#   .\install.ps1 -Yes                take every default (local use only, data in %LOCALAPPDATA%\PrettySuite)
#   .\install.ps1 -ContentDir D:\PrettySuite -Autostart
#
# If Windows blocks the script:  powershell -ExecutionPolicy Bypass -File .\install.ps1
param(
  [string]$DataDir,
  [string]$ContentDir,
  [string]$CacheDir,
  [int]$Port,
  [switch]$Remote,
  [string]$Password,
  [switch]$Autostart,
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Ask($question, $default) {
  if ($Yes) { return $default }
  $answer = Read-Host "$question [$default]"
  if ([string]::IsNullOrWhiteSpace($answer)) { return $default }
  return $answer.Trim()
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host 'Node.js is not installed. Pretty Suite needs Node 22.13 or newer: https://nodejs.org/en/download'
  exit 1
}
$version = [version]((node -v).TrimStart('v'))
if ($version -lt [version]'22.13.0') {
  Write-Host "Node $version is too old. Pretty Suite needs Node 22.13 or newer: https://nodejs.org/en/download"
  exit 1
}

Write-Host ''
Write-Host 'Pretty Suite keeps three kinds of files. Press Enter to accept a default.'
if (-not $DataDir) { $DataDir = Ask 'Database and saved sessions (small)' (Join-Path $env:LOCALAPPDATA 'PrettySuite') }
if (-not $ContentDir) { $ContentDir = Ask 'Archived attachments (this is what grows; pick the drive with room)' (Join-Path $DataDir 'attachments') }
if (-not $CacheDir) { $CacheDir = Ask 'Cache' (Join-Path $DataDir 'login-profiles') }
if (-not $Port) { $Port = [int](Ask 'Port' '4477') }
if (-not $Remote -and -not $Password -and -not $Yes) {
  $Remote = (Ask 'Reach it from other machines, with a password? (yes/no)' 'no') -match '^y'
}

$hostAddress = '127.0.0.1'
$generated = $false
if ($Remote -or $Password) {
  $hostAddress = '0.0.0.0'
  if (-not $Password) {
    $Password = (node -e "console.log(require('crypto').randomBytes(15).toString('base64url'))").Trim()
    $generated = $true
  }
} else {
  $Password = ''
}

foreach ($dir in $DataDir, $ContentDir, $CacheDir) { New-Item -ItemType Directory -Force $dir | Out-Null }
@(
  '# Written by install.ps1. Edit and restart Pretty Suite to change anything.'
  "PORT='$Port'"
  "HOST='$hostAddress'"
  "PRETTY_DATA_DIR='$DataDir'"
  "PRETTY_CONTENT_DIR='$ContentDir'"
  "PRETTY_CACHE_DIR='$CacheDir'"
  "PRETTY_PASSWORD='$Password'"
) | Set-Content -Path .env -Encoding ascii

Write-Host ''
Write-Host 'Installing and building (a minute or two)...'
npm ci --no-audit --no-fund
if ($LASTEXITCODE) { exit $LASTEXITCODE }
npm run build
if ($LASTEXITCODE) { exit $LASTEXITCODE }

if (-not $Autostart -and -not $Yes) { $Autostart = (Ask 'Start it automatically when you log in? (yes/no)' 'no') -match '^y' }
if ($Autostart) {
  $action = New-ScheduledTaskAction -Execute $node.Source -Argument '--disable-warning=ExperimentalWarning server/index.js' -WorkingDirectory $PSScriptRoot
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName 'Pretty Suite' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Start-ScheduledTask -TaskName 'Pretty Suite'
  Write-Host 'Running now, and at every log-in (Task Scheduler: "Pretty Suite").'
} else {
  Write-Host 'Start it with:  npm start'
}

Write-Host ''
if ($hostAddress -eq '0.0.0.0') {
  Write-Host "Open http://<this machine's address>:$Port"
  if ($generated) { Write-Host "Password: $Password   (also saved in .env)" }
  Write-Host 'That address is plain HTTP. Over the internet, put it behind HTTPS (see README: Remote use).'
} else {
  Write-Host "Open http://localhost:$Port"
}
