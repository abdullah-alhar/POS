<#
  Marina POS - updates an installed Marina POS to the version in this folder.

  What it does:
    1. Checks Marina POS is installed (C:\MarinaPOS) and the database is running
    2. Makes a backup of all data (C:\MarinaPOS\backups\...before-update.dump)
    3. Stops the POS server and keeps the current version as C:\MarinaPOS\app.prev
    4. Copies the new version, updates the database and starts the server again
    5. Checks the new version answers. If anything goes wrong, the old version and the data
       from step 2 are put back automatically.

  Run UPDATE.cmd (it asks for administrator rights), or from an admin PowerShell:
    powershell -ExecutionPolicy Bypass -File .\update.ps1
#>
[CmdletBinding()]
param(
  [string]$Root = 'C:\MarinaPOS'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]'Tls13'
} catch {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
}

function Step($text) { Write-Host ''; Write-Host "==> $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "    $text" -ForegroundColor Green }
function Info($text) { Write-Host "    $text" }
function Warn($text) { Write-Host "    $text" -ForegroundColor Yellow }
function Fail($text) {
  Write-Host ''
  Write-Host "ERROR: $text" -ForegroundColor Red
  Write-Host "Full details: $Root\logs\update.log" -ForegroundColor Red
  try { Stop-Transcript | Out-Null } catch { }
  exit 1
}

# Runs node with a script and returns its exit code and output (errors from node must not stop PowerShell).
function Invoke-Node([string[]]$arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $lines = & $nodeExe @arguments 2>&1 | ForEach-Object { "$_" }
    $code = $LASTEXITCODE
  } catch {
    $lines = @("$($_.Exception.Message)")
    $code = -1
  } finally {
    $ErrorActionPreference = $previous
  }
  foreach ($line in $lines) { Info $line }
  return [pscustomobject]@{ Code = $code; Lines = @($lines) }
}

function Get-Health {
  try {
    $res = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3
    if ($res.StatusCode -eq 200) { return ($res.Content | ConvertFrom-Json) }
  } catch { }
  return $null
}

function Wait-Healthy([int]$seconds) {
  for ($i = 0; $i -lt $seconds; $i++) {
    $h = Get-Health
    if ($h -and $h.database -eq 'ok') { return $h }
    Start-Sleep -Seconds 1
  }
  return $null
}

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Please run UPDATE.cmd (it asks for administrator rights).' -ForegroundColor Red
  exit 1
}

$envFile = Join-Path $Root 'config\marina-pos.env'
$nodeExe = Join-Path $Root 'node\node.exe'
if (-not ((Test-Path $envFile) -and (Test-Path $nodeExe) -and (Test-Path (Join-Path $Root 'app')))) {
  Write-Host "Marina POS is not installed in $Root. Run INSTALL.cmd instead." -ForegroundColor Red
  exit 1
}
New-Item -ItemType Directory -Force -Path (Join-Path $Root 'logs'), (Join-Path $Root 'backups') | Out-Null
try { Start-Transcript -Path (Join-Path $Root 'logs\update.log') -Append | Out-Null } catch { }

$newVersion = (Get-Content (Join-Path $Here 'VERSION') -ErrorAction SilentlyContinue | Select-Object -First 1)
if (-not $newVersion) { Fail 'This folder does not contain a Marina POS release (VERSION file missing).' }
$newVersion = $newVersion.Trim()

$healthUrl = 'https://127.0.0.1/api/health'
$kioskFile = Join-Path $Root 'config\kiosk.json'
if (Test-Path $kioskFile) {
  try { $healthUrl = (Get-Content $kioskFile -Raw | ConvertFrom-Json).health } catch { }
}

# Settings added by newer versions (older installs do not have them yet).
$envText = Get-Content $envFile -Raw
$extra = @()
if ($envText -notmatch '(?m)^BACKUP_DIR=') { $extra += "BACKUP_DIR=$(Join-Path $Root 'backups')" }
if ($envText -notmatch '(?m)^PG_BIN_DIR=') { $extra += "PG_BIN_DIR=$(Join-Path $Root 'pgsql\bin')" }
if ($extra.Count) { Add-Content -Path $envFile -Value $extra -Encoding ascii }
$env:DOTENV_CONFIG_PATH = $envFile

Step 'Checking the installed version'
try { Start-Service MarinaPOS-DB } catch { Fail "The database service did not start: $($_.Exception.Message)" }
$before = Get-Health
$oldVersion = if ($before) { $before.version } else { 'unknown (the POS server is not answering)' }
Info "Installed: $oldVersion"
Info "New:       $newVersion"

Step 'Backing up the data'
$backup = Invoke-Node @((Join-Path $Here 'app\api\dist\cli\backup.js'))
if ($backup.Code -ne 0) { Fail 'The backup failed, so nothing was changed. The shop can keep using the current version.' }
$backupFile = ($backup.Lines | Where-Object { $_ -match '\.dump$' } | Select-Object -Last 1)
if (-not $backupFile -or -not (Test-Path $backupFile.Trim())) { Fail 'The backup file was not found, so nothing was changed.' }
$backupFile = $backupFile.Trim()
Ok "Backup: $backupFile"

Step 'Installing the new version'
Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*MarinaPOS\chrome*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
try { Stop-Service MarinaPOS -Force } catch { Warn "Stopping the POS server: $($_.Exception.Message)" }
Start-Sleep -Seconds 2

$app = Join-Path $Root 'app'
$prev = Join-Path $Root 'app.prev'
if (Test-Path $prev) { Remove-Item $prev -Recurse -Force }
Move-Item $app $prev
robocopy (Join-Path $Here 'app') $app /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
$copyOk = $LASTEXITCODE -lt 8
foreach ($f in 'start-pos.ps1', 'uninstall.ps1') {
  if (Test-Path (Join-Path $Here $f)) { Copy-Item (Join-Path $Here $f) (Join-Path $Root $f) -Force }
}

$failure = $null
if (-not $copyOk) { $failure = 'Copying the new files failed.' }
if (-not $failure) {
  Step 'Updating the database'
  Push-Location (Join-Path $app 'api')
  try {
    $migrate = Invoke-Node @('dist\cli\migrate.js')
    if ($migrate.Code -ne 0) { $failure = 'The database update failed.' }
  } finally { Pop-Location }
}
if (-not $failure) {
  Step 'Starting Marina POS'
  try { Start-Service MarinaPOS } catch { $failure = "The POS server did not start: $($_.Exception.Message)" }
}
if (-not $failure) {
  $after = Wait-Healthy 90
  if (-not $after) { $failure = 'The new version did not answer within 90 seconds.' }
  elseif ($after.version -ne $newVersion) { $failure = "The server reports version $($after.version), expected $newVersion." }
}

if ($failure) {
  Write-Host ''
  Write-Host "PROBLEM: $failure Putting the previous version back..." -ForegroundColor Yellow
  try { Stop-Service MarinaPOS -Force } catch { }
  Start-Sleep -Seconds 2
  $restore = Invoke-Node @((Join-Path $Here 'app\api\dist\cli\backup.js'), 'restore', $backupFile)
  if ($restore.Code -ne 0) { Warn "Putting the data back failed. The backup is safe in $backupFile; ask for help before selling." }
  if (Test-Path $app) { Remove-Item $app -Recurse -Force -ErrorAction SilentlyContinue }
  Move-Item $prev $app
  try { Start-Service MarinaPOS } catch { }
  if (Wait-Healthy 90) { Ok 'The previous version is running again with the data as it was before the update.' }
  else { Warn "The previous version did not start. See $Root\logs." }
  Fail "The update to $newVersion did not work. $failure"
}

Ok "Marina POS $newVersion is running"
$startScript = Join-Path $Root 'start-pos.ps1'
if (Test-Path $kioskFile) {
  Start-Process powershell -ArgumentList "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`"" | Out-Null
}
Write-Host ''
Write-Host "  Updated from $oldVersion to $newVersion." -ForegroundColor Green
Write-Host "  The previous version is kept in $prev, and the data from before the update in"
Write-Host "  $backupFile"
Write-Host ''
try { Stop-Transcript | Out-Null } catch { }
