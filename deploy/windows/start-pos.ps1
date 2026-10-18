<#
  Opens ShopPOS in Chrome (or Edge) kiosk mode (full screen, no address bar).
  Runs at Windows start and from the desktop icon. Waits until the POS server is ready.
  To leave full screen: user menu > "Exit full-screen POS", or press Alt+F4.
#>
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfg = Get-Content (Join-Path $Root 'config\kiosk.json') -Raw | ConvertFrom-Json

# Already open? Bring nothing up twice.
$profileDir = Join-Path $env:LOCALAPPDATA 'ShopPOS\chrome'
$running = Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*$profileDir*" }
if ($running) { exit 0 }

# Wait up to 2 minutes for the server (Windows may still be starting services).
for ($i = 0; $i -lt 120; $i++) {
  try {
    if ((Invoke-WebRequest -Uri $cfg.health -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { break }
  } catch { }
  Start-Sleep -Seconds 1
}

New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
$chromeArgs = @(
  '--kiosk',
  '--kiosk-printing',              # print receipts without the print dialog (browser printing mode)
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-session-crashed-bubble',
  '--disable-features=Translate',
  '--overscroll-history-navigation=0',
  '--disable-pinch',
  "--user-data-dir=`"$profileDir`""
)
# Microsoft Edge needs this to really hide everything.
if ($cfg.chrome -like '*msedge.exe') { $chromeArgs += '--edge-kiosk-type=fullscreen' }
$chromeArgs += $cfg.url
Start-Process -FilePath $cfg.chrome -ArgumentList $chromeArgs
