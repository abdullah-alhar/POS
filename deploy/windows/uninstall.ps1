<#
  Removes the Marina POS services, shortcuts and the pos.shop address.
  Your data (database, backups) is KEPT unless you add -RemoveData.
    powershell -ExecutionPolicy Bypass -File C:\MarinaPOS\uninstall.ps1
#>
[CmdletBinding()]
param(
  [string]$Root = 'C:\MarinaPOS',
  [string]$HostName = 'pos.shop',
  [switch]$RemoveData
)
$ErrorActionPreference = 'Continue'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Please run as administrator.' -ForegroundColor Red
  exit 1
}

Write-Host 'Stopping Marina POS...'
Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*MarinaPOS\chrome*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

$serviceExe = Join-Path $Root 'service\MarinaPOS.exe'
if (Get-Service MarinaPOS -ErrorAction SilentlyContinue) {
  Stop-Service MarinaPOS -Force -ErrorAction SilentlyContinue
  if (Test-Path $serviceExe) { & $serviceExe uninstall | Out-Null } else { sc.exe delete MarinaPOS | Out-Null }
}
if (Get-Service MarinaPOS-DB -ErrorAction SilentlyContinue) {
  Stop-Service MarinaPOS-DB -Force -ErrorAction SilentlyContinue
  & (Join-Path $Root 'pgsql\bin\pg_ctl.exe') unregister -N 'MarinaPOS-DB' | Out-Null
}

foreach ($lnk in @(
    (Join-Path ([Environment]::GetFolderPath('CommonStartup')) 'Marina POS.lnk'),
    (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Marina POS.lnk'))) {
  Remove-Item $lnk -Force -ErrorAction SilentlyContinue
}

# Remove this laptop's Marina POS certificate authority from the trusted certificates.
Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Subject -like '*Marina POS Local CA*' } |
  Remove-Item -ErrorAction SilentlyContinue

$hosts = "$env:SystemRoot\System32\drivers\etc\hosts"
$lines = Get-Content $hosts | Where-Object { $_ -notmatch "^\s*127\.0\.0\.1\s+$([regex]::Escape($HostName))\s*$" }
Set-Content -Path $hosts -Value $lines -Encoding ascii

if ($RemoveData) {
  $answer = Read-Host "Type DELETE to remove ALL Marina POS data in $Root (bills, products, backups)"
  if ($answer -eq 'DELETE') {
    Remove-Item $Root -Recurse -Force
    Write-Host 'All Marina POS files and data were removed.' -ForegroundColor Yellow
  } else {
    Write-Host 'Data kept.'
  }
} else {
  Write-Host "Services removed. Your data is still in $Root\data (run install again to use it)." -ForegroundColor Green
}
