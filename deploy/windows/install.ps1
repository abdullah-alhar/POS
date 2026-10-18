<#
  ShopPOS - Windows installer.

  What it does (safe to run again; it keeps existing data and passwords):
    0. Checks the computer: Windows version, processor (x64 / ARM64), disk space, internet,
       Node.js, PostgreSQL, Chrome and port 80, and shows a checklist
    1. Node.js: uses the copy in .\vendor, or a suitable Node.js already installed, or downloads it
    2. PostgreSQL: uses .\vendor, or a PostgreSQL already installed (14 or newer), or downloads it
    3. Copies the app to C:\ShopPOS, creates the database and runs the database updates
    4. Installs two Windows services that start automatically:
         ShopPOS-DB  (PostgreSQL)      ShopPOS  (the POS server on port 80)
    5. Adds "pos.shop" to the hosts file
    6. Sets up HTTPS (padlock): a certificate authority for this laptop only, trusted by Windows
    7. Opens Chrome (or Edge) in kiosk mode at every Windows start

  Everything is written to C:\ShopPOS\logs\install.log, so problems can be checked later.

  Run INSTALL.cmd (it asks for administrator rights), or from an admin PowerShell:
    powershell -ExecutionPolicy Bypass -File .\install.ps1             (real shop: asks for passwords)
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -SampleData (test: sample products, test passwords)
  Files downloaded by hand can be given directly:
    install.ps1 -PostgresZip D:\postgresql-17.11-1-windows-x64-binaries.zip -NodeZip D:\node-v22.23.3-win-x64.zip
#>
[CmdletBinding()]
param(
  [string]$Root = 'C:\ShopPOS',
  # https://pos.shop runs on HttpsPort; plain http on Port only redirects to it.
  [int]$Port = 80,
  [int]$HttpsPort = 443,
  [string]$HostName = 'pos.shop',
  # Fill the shop with ~60 sample products and use test passwords (for testing only).
  [switch]$SampleData,
  # First install only. Left empty, the installer asks for them (or uses test values with -SampleData).
  [string]$AdminPassword,
  [string]$AdminPin,
  [string]$SuperAdminPassword,
  [string]$SuperAdminPin,
  [switch]$NoKiosk,
  # A PostgreSQL "binaries" zip or a Node.js zip downloaded by hand (optional).
  [string]$PostgresZip,
  [string]$NodeZip
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

# Windows PowerShell 32-bit on 64-bit Windows sees the wrong Program Files and registry: restart as 64-bit.
if ([Environment]::Is64BitOperatingSystem -and -not [Environment]::Is64BitProcess) {
  $ps64 = Join-Path $env:windir 'sysnative\WindowsPowerShell\v1.0\powershell.exe'
  if (Test-Path $ps64) {
    $passArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $MyInvocation.MyCommand.Path)
    foreach ($k in $PSBoundParameters.Keys) {
      $v = $PSBoundParameters[$k]
      if ($v -is [switch]) { if ($v.IsPresent) { $passArgs += "-$k" } } else { $passArgs += "-$k"; $passArgs += "$v" }
    }
    & $ps64 @passArgs
    exit $LASTEXITCODE
  }
}

# Allow modern TLS for downloads (TLS 1.3 where Windows supports it).
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]'Tls13'
} catch {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
}

# Versions used when nothing suitable is installed. Each list is tried in order.
$MinNodeVersion = [version]'22.12.0'
$NodeVersions = @('v22.23.3', 'v22.22.2', 'v22.21.1')
$MinPostgresMajor = 14
$PostgresVersions = @('17.11-1', '17.10-1', '17.9-1')
$WinSWVersion = 'v2.12.0'
# Some servers refuse PowerShell's default user agent; look like a normal browser.
$UserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

function Step($text) { Write-Host ''; Write-Host "==> $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "    $text" -ForegroundColor Green }
function Info($text) { Write-Host "    $text" }
function Warn($text) { Write-Host "    $text" -ForegroundColor Yellow }
function Fail($text) {
  Write-Host ''
  Write-Host "ERROR: $text" -ForegroundColor Red
  Write-Host "Full details: $Root\logs\install.log" -ForegroundColor Red
  try { Stop-Transcript | Out-Null } catch { }
  exit 1
}
function Check($ok, $label, $detail) {
  if ($ok -eq $true) { Write-Host "    [OK]   $label  $detail" -ForegroundColor Green }
  elseif ($ok -eq $false) { Write-Host "    [X]    $label  $detail" -ForegroundColor Red }
  else { Write-Host "    [!]    $label  $detail" -ForegroundColor Yellow }
}

function New-Secret([int]$bytes = 32) {
  $buffer = New-Object byte[] $bytes
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
  return -join ($buffer | ForEach-Object { $_.ToString('x2') })
}

function Wait-Until([scriptblock]$test, [int]$seconds, $what) {
  for ($i = 0; $i -lt $seconds; $i++) {
    if (& $test) { return }
    Start-Sleep -Seconds 1
  }
  Fail "$what did not start within $seconds seconds. See the logs in $Root\logs."
}

<#
  Runs a program (initdb, pg_ctl ...), shows everything it prints and saves it to logs\<name>.log.
  Error output from programs must not stop PowerShell itself, so the error mode is relaxed here.
#>
function Invoke-Native($exe, [string[]]$arguments, $logName) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $lines = & $exe @arguments 2>&1 | ForEach-Object { "$_" }
    $code = $LASTEXITCODE
  } catch {
    $lines = @("$($_.Exception.Message)")
    $code = -1
  } finally {
    $ErrorActionPreference = $previous
  }
  if ($logName) {
    $logFile = Join-Path $Root "logs\$logName.log"
    @("> $exe $($arguments -join ' ')", "exit code: $code") + $lines | Set-Content -Path $logFile -Encoding utf8
  }
  return [pscustomobject]@{ Code = $code; Lines = @($lines); Text = (@($lines) -join "`n").Trim() }
}

# Is this a zip file that can be opened?
function Test-Zip($path) {
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($path)
    $count = $zip.Entries.Count
    $zip.Dispose()
    return $count -gt 0
  } catch { return $false }
}

# Unzip quickly: tar.exe (built into Windows 10/11) is much faster than Expand-Archive.
function Expand-Zip($zip, $destination) {
  New-Item -ItemType Directory -Force -Path $destination | Out-Null
  $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
  if (Test-Path $tar) {
    & $tar -xf $zip -C $destination
    if ($LASTEXITCODE -eq 0) { return }
    Warn 'tar.exe could not unpack the file; trying another way...'
  }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory($zip, $destination)
}

<#
  Downloads a file, trying three different ways, because one of them is often blocked
  (proxy, antivirus, old .NET settings):  curl.exe  ->  BITS  ->  Invoke-WebRequest.
  Returns $null and records the reasons in $script:DownloadErrors if all fail.
#>
$script:DownloadErrors = @()
function Save-Url($url, $path, [int64]$minBytes) {
  $part = "$path.part"
  Remove-Item $part -Force -ErrorAction SilentlyContinue

  $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
  if (Test-Path $curl) {
    Info "Downloading with curl: $url"
    & $curl -L --fail --retry 3 --retry-delay 5 --connect-timeout 30 --ssl-revoke-best-effort -A $UserAgent -o $part $url
    if ($LASTEXITCODE -eq 0 -and (Test-Path $part) -and (Get-Item $part).Length -ge $minBytes) {
      Move-Item $part $path -Force
      return $path
    }
    $script:DownloadErrors += "curl.exe: exit code $LASTEXITCODE"
  }

  try {
    Info 'Trying Windows BITS...'
    Import-Module BitsTransfer -ErrorAction Stop
    Start-BitsTransfer -Source $url -Destination $part -ErrorAction Stop
    if ((Get-Item $part).Length -ge $minBytes) { Move-Item $part $path -Force; return $path }
    $script:DownloadErrors += 'BITS: file too small'
  } catch {
    $script:DownloadErrors += "BITS: $($_.Exception.Message)"
  }

  try {
    Info 'Trying PowerShell download...'
    $webClient = New-Object Net.WebClient
    $webClient.Headers['User-Agent'] = $UserAgent
    $webClient.Proxy = [Net.WebRequest]::GetSystemWebProxy()
    $webClient.Proxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials
    $webClient.DownloadFile($url, $part)
    if ((Get-Item $part).Length -ge $minBytes) { Move-Item $part $path -Force; return $path }
    $script:DownloadErrors += 'PowerShell: file too small'
  } catch {
    $script:DownloadErrors += "PowerShell: $($_.Exception.Message)"
  }

  Remove-Item $part -Force -ErrorAction SilentlyContinue
  return $null
}

function Show-DownloadHelp($what, $urls, $fileHint) {
  Write-Host ''
  Write-Host "Could not download $what. What went wrong:" -ForegroundColor Red
  foreach ($e in $script:DownloadErrors) { Write-Host "  - $e" -ForegroundColor Red }
  Write-Host ''
  Write-Host 'How to fix:' -ForegroundColor Yellow
  Write-Host '  1. Check that a website opens in Chrome on this laptop.'
  Write-Host '  2. If an antivirus or firewall asks about PowerShell or curl, allow it, then run INSTALL.cmd again.'
  Write-Host "  3. Or download it with Chrome and put the file in the 'vendor' folder next to install.ps1:"
  foreach ($u in $urls) { Write-Host "       $u" }
  Write-Host "     ($fileHint)"
  Fail "Could not download $what."
}

function Get-OsArchitecture {
  try {
    $arch = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    if ($arch -eq 'X64') { return 'x64' }
    if ($arch -eq 'Arm64') { return 'arm64' }
    if ($arch -eq 'X86') { return 'x86' }
  } catch { }
  $a = $env:PROCESSOR_ARCHITEW6432
  if (-not $a) { $a = $env:PROCESSOR_ARCHITECTURE }
  switch ($a) { 'AMD64' { return 'x64' } 'ARM64' { return 'arm64' } default { return 'x86' } }
}

# Node.js found on this computer, if it is new enough and fits the processor.
function Find-InstalledNode($arch) {
  $candidates = @()
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { $candidates += $cmd.Source }
  $candidates += "$env:ProgramFiles\nodejs\node.exe"
  $candidates += "${env:ProgramFiles(x86)}\nodejs\node.exe"
  foreach ($exe in ($candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique)) {
    try {
      $versionText = (& $exe --version).Trim().TrimStart('v')
      $nodeArch = (& $exe -p 'process.arch').Trim()
      $ok = ([version]$versionText -ge $MinNodeVersion) -and ($nodeArch -eq $arch -or ($arch -eq 'arm64' -and $nodeArch -eq 'x64'))
      return [pscustomobject]@{ Path = $exe; Version = $versionText; Arch = $nodeArch; Suitable = $ok }
    } catch { }
  }
  return $null
}

# PostgreSQL installed on this computer (e.g. with the EnterpriseDB installer), newest first.
function Find-InstalledPostgres {
  $dirs = @()
  foreach ($key in (Get-ChildItem 'HKLM:\SOFTWARE\PostgreSQL\Installations' -ErrorAction SilentlyContinue)) {
    $base = (Get-ItemProperty $key.PSPath -ErrorAction SilentlyContinue).'Base Directory'
    if ($base) { $dirs += $base }
  }
  $dirs += Get-ChildItem "$env:ProgramFiles\PostgreSQL" -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
  $best = $null
  foreach ($dir in ($dirs | Select-Object -Unique)) {
    $pgCtl = Join-Path $dir 'bin\pg_ctl.exe'
    if (-not ((Test-Path $pgCtl) -and (Test-Path (Join-Path $dir 'bin\postgres.exe')))) { continue }
    try {
      $text = & $pgCtl --version
      if ($text -notmatch '(\d+)\.(\d+)') { continue }
      $v = [version]"$($Matches[1]).$($Matches[2])"
      if ($v.Major -lt $MinPostgresMajor) { continue }
      if (-not $best -or $v -gt $best.Version) { $best = [pscustomobject]@{ Dir = $dir; Version = $v } }
    } catch { }
  }
  return $best
}

function Test-Url($url) {
  try {
    $req = [Net.HttpWebRequest]::Create($url)
    $req.Method = 'HEAD'
    $req.Timeout = 15000
    $req.UserAgent = $UserAgent
    $req.AllowAutoRedirect = $true
    $res = $req.GetResponse()
    $res.Close()
    return $true
  } catch {
    if ($_.Exception.InnerException -and $_.Exception.InnerException.Response) { return $true } # server answered
    return $false
  }
}

# ── Start ─────────────────────────────────────────────────────────────────
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Please run as administrator (right-click INSTALL.cmd > Run as administrator).' -ForegroundColor Red
  exit 1
}
if (-not (Test-Path (Join-Path $Here 'app\api\dist\main.js'))) {
  Write-Host "The 'app' folder is missing next to install.ps1. Unzip the whole folder first." -ForegroundColor Red
  exit 1
}
New-Item -ItemType Directory -Force -Path (Join-Path $Root 'logs') | Out-Null
try { Start-Transcript -Path (Join-Path $Root 'logs\install.log') -Append | Out-Null } catch { }
# Files copied from a downloaded zip are marked "from the internet"; clear that so nothing is blocked.
Get-ChildItem -Path $Here -Recurse -File | Unblock-File -ErrorAction SilentlyContinue
$vendor = Join-Path $Here 'vendor'
New-Item -ItemType Directory -Force -Path $vendor | Out-Null

Write-Host ''
Write-Host '  ShopPOS installer' -ForegroundColor White
$SiteUrl = "https://$HostName$(if ($HttpsPort -ne 443) { ":$HttpsPort" })"
Write-Host "  Folder: $Root    Address: $SiteUrl"

# ── 0. System check ───────────────────────────────────────────────────────
Step 'Checking this computer'
$os = Get-CimInstance Win32_OperatingSystem
$build = [int]$os.BuildNumber
Check ($build -ge 17763) 'Windows' "$($os.Caption) (build $build)"
if ($build -lt 17763) { Fail 'ShopPOS needs Windows 10 (version 1809 or newer) or Windows 11. Please update Windows.' }

$arch = Get-OsArchitecture
if ($arch -eq 'x86') {
  Check $false 'Processor' '32-bit Windows'
  Fail 'ShopPOS needs 64-bit Windows (x64 or ARM64). PostgreSQL does not run on 32-bit Windows.'
}
Check $true 'Processor' "$arch$(if ($arch -eq 'arm64') { ' (the database runs in x64 compatibility mode, Windows 11 needed)' })"
if ($arch -eq 'arm64' -and $build -lt 22000) { Fail 'On ARM processors ShopPOS needs Windows 11.' }

$drive = (Split-Path -Qualifier $Root).TrimEnd(':')
$freeGb = [math]::Round((Get-PSDrive $drive).Free / 1GB, 1)
Check ($freeGb -ge 3) 'Free disk space' "$freeGb GB on ${drive}:"
if ($freeGb -lt 3) { Fail "At least 3 GB free space is needed on ${drive}:." }

$ramGb = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
Check ($(if ($ramGb -ge 4) { $true } else { 'warn' })) 'Memory' "$ramGb GB"

$systemNode = Find-InstalledNode $arch
$myNode = Join-Path $Root 'node\node.exe'
if (Test-Path $myNode) {
  Check $true 'Node.js' "already set up for ShopPOS ($(& $myNode --version))"
} elseif ($systemNode -and $systemNode.Suitable) {
  Check $true 'Node.js' "installed: v$($systemNode.Version) $($systemNode.Arch) at $($systemNode.Path) (will be used)"
} elseif ($systemNode) {
  Check 'warn' 'Node.js' "installed v$($systemNode.Version) $($systemNode.Arch) is too old or wrong type; Node.js 22 will be set up"
} else {
  Check 'warn' 'Node.js' 'not installed; it will be set up'
}

$systemPg = Find-InstalledPostgres
if (Test-Path (Join-Path $Root 'pgsql\bin\postgres.exe')) {
  Check $true 'PostgreSQL' 'already set up for ShopPOS'
} elseif ($systemPg) {
  Check $true 'PostgreSQL' "installed: version $($systemPg.Version) at $($systemPg.Dir) (will be used)"
} else {
  Check 'warn' 'PostgreSQL' 'not installed; it will be set up'
}

$chromePath = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
  # Microsoft Edge (on every Windows 10/11) is used when Chrome is not installed.
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
Check ($(if ($chromePath) { $true } else { 'warn' })) 'Google Chrome' "$(if ($chromePath) { 'found' } else { 'not found: install Chrome for kiosk mode' })"

foreach ($p in @($Port, $HttpsPort)) {
  $busy = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue |
    Where-Object { (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName -ne 'node' }
  if ($busy) {
    $owner = (Get-Process -Id $busy[0].OwningProcess -ErrorAction SilentlyContinue).ProcessName
    if ($owner -eq 'System') { $owner = "Windows (IIS / 'World Wide Web Publishing Service')" }
    Check $false "Port $p" "used by $owner"
    Fail "Port $p is already used by $owner. Stop that program, or run: install.ps1 -Port 8080 -HttpsPort 8443"
  }
  Check $true "Port $p" 'free'
}

# Internet is only needed for what is missing.
$needNode = -not (Test-Path $myNode) -and -not ($systemNode -and $systemNode.Suitable) -and -not $NodeZip -and
  -not (Get-ChildItem $vendor -Filter "node-v22*-win-$arch.zip" -ErrorAction SilentlyContinue)
$needPg = -not (Test-Path (Join-Path $Root 'pgsql\bin\postgres.exe')) -and -not $systemPg -and -not $PostgresZip -and
  -not (Get-ChildItem $vendor -Filter 'postgresql-*-windows-x64-binaries.zip' -ErrorAction SilentlyContinue)
$needWinSW = -not (Test-Path (Join-Path $Root 'service\ShopPOS.exe')) -and
  -not (Get-ChildItem $vendor -Filter 'WinSW-x64*.exe' -ErrorAction SilentlyContinue)
if ($needNode -or $needPg -or $needWinSW) {
  $nodeOk = Test-Url 'https://nodejs.org/dist/index.json'
  $edbOk = Test-Url 'https://get.enterprisedb.com/'
  $githubOk = Test-Url 'https://github.com/'
  Check ($nodeOk -and $edbOk -and $githubOk) 'Internet' "nodejs.org: $(if ($nodeOk) {'ok'} else {'NO'})  enterprisedb.com: $(if ($edbOk) {'ok'} else {'NO'})  github.com: $(if ($githubOk) {'ok'} else {'NO'})"
  if (-not ($nodeOk -or $edbOk -or $githubOk)) {
    Warn 'No internet from PowerShell. The installer will still try (curl / BITS), then explain what to do.'
  }
} else {
  Check $true 'Internet' 'not needed (everything is in the vendor folder or already installed)'
}

# Security IDs work on every Windows language: Administrators, SYSTEM, Users, NetworkService.
$Admins = '*S-1-5-32-544'; $System = '*S-1-5-18'; $Users = '*S-1-5-32-545'; $NetSvc = '*S-1-5-20'
New-Item -ItemType Directory -Force -Path $Root | Out-Null
# Only administrators may change the POS files; normal users can read and run them.
icacls $Root /inheritance:r /grant:r "${Admins}:(OI)(CI)F" "${System}:(OI)(CI)F" "${Users}:(OI)(CI)RX" /Q | Out-Null
$dirs = 'app', 'config', 'data', 'data\storage', 'logs', 'service', 'backups'
foreach ($d in $dirs) { New-Item -ItemType Directory -Force -Path (Join-Path $Root $d) | Out-Null }

# ── Accounts (first install only) ────────────────────────────────────────
function Read-NewSecret($label, [int]$minLength, [string]$pattern, $rule) {
  while ($true) {
    $a = Read-Host "    $label" -AsSecureString
    $b = Read-Host '    Type it again' -AsSecureString
    $plainA = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($a))
    $plainB = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($b))
    if ($plainA -ne $plainB) { Warn 'The two did not match. Try again.'; continue }
    if ($plainA.Length -lt $minLength -or ($pattern -and $plainA -notmatch $pattern)) { Warn $rule; continue }
    return $plainA
  }
}

$firstInstall = -not (Test-Path (Join-Path $Root 'config\secrets.json'))
$testPasswords = $false
if ($firstInstall) {
  if ($SampleData) {
    if (-not $AdminPassword) { $AdminPassword = 'admin123'; $testPasswords = $true }
    if (-not $AdminPin) { $AdminPin = '1234'; $testPasswords = $true }
    if (-not $SuperAdminPassword) { $SuperAdminPassword = 'super123'; $testPasswords = $true }
    if (-not $SuperAdminPin) { $SuperAdminPin = '9999'; $testPasswords = $true }
  } else {
    Step 'Shop accounts'
    Info 'Choose the passwords for this shop. Write them down and keep them somewhere safe.'
    Info '(Nothing is shown while you type.)'
    if (-not $AdminPassword) { $AdminPassword = Read-NewSecret 'Shop owner password (username: admin)' 6 '' 'Use at least 6 characters.' }
    if (-not $AdminPin) { $AdminPin = Read-NewSecret 'Shop owner PIN (4 to 6 digits)' 4 '^\d{4,6}$' 'The PIN must be 4 to 6 digits.' }
    if (-not $SuperAdminPassword) { $SuperAdminPassword = Read-NewSecret 'Super Admin password (username: superadmin)' 6 '' 'Use at least 6 characters.' }
    if (-not $SuperAdminPin) { $SuperAdminPin = Read-NewSecret 'Super Admin PIN (4 to 6 digits)' 4 '^\d{4,6}$' 'The PIN must be 4 to 6 digits.' }
    Ok 'Passwords chosen'
  }
}

# ── 1. Node.js ────────────────────────────────────────────────────────────
Step 'Node.js'
$nodeExe = $myNode
$nodeOkVersion = $false
if (Test-Path $nodeExe) {
  try { $nodeOkVersion = [version]((& $nodeExe --version).Trim().TrimStart('v')) -ge $MinNodeVersion } catch { }
}
if (-not $nodeOkVersion) {
  if (Get-Service ShopPOS -ErrorAction SilentlyContinue) { Stop-Service ShopPOS -ErrorAction SilentlyContinue }
  New-Item -ItemType Directory -Force -Path (Split-Path $nodeExe) | Out-Null
  if ($systemNode -and $systemNode.Suitable -and -not $NodeZip) {
    Info "Using the Node.js already installed (v$($systemNode.Version))"
    Copy-Item $systemNode.Path $nodeExe -Force
  } else {
    $zip = $NodeZip
    if (-not $zip) {
      $zip = Get-ChildItem $vendor -Filter "node-v22*-win-$arch.zip" -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
    }
    if ($zip -and -not (Test-Zip $zip)) { Warn "$zip is damaged; downloading again."; Remove-Item $zip -Force; $zip = $null }
    if (-not $zip) {
      $urls = @()
      foreach ($v in $NodeVersions) {
        $file = "node-$v-win-$arch.zip"
        $url = "https://nodejs.org/dist/$v/$file"
        $urls += $url
        $zip = Save-Url $url (Join-Path $vendor $file) 20MB
        if ($zip -and (Test-Zip $zip)) { break }
        $zip = $null
      }
      if (-not $zip) { Show-DownloadHelp 'Node.js' $urls "the file for $arch processors" }
    }
    $tmp = Join-Path $Root 'tmp-node'
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Zip $zip $tmp
    $found = Get-ChildItem $tmp -Recurse -Filter node.exe | Select-Object -First 1
    if (-not $found) { Fail "node.exe was not found inside $zip." }
    Copy-Item $found.FullName $nodeExe -Force
    Remove-Item $tmp -Recurse -Force
  }
}
try { $nodeVersionText = (& $nodeExe --version).Trim(); $nodeArchText = (& $nodeExe -p 'process.arch').Trim() }
catch { Fail "Node.js does not start on this computer: $($_.Exception.Message)" }
Ok "Node.js $nodeVersionText ($nodeArchText)"

# ── 2. PostgreSQL ─────────────────────────────────────────────────────────
Step 'PostgreSQL database'
$pgDir = Join-Path $Root 'pgsql'
$pgBin = Join-Path $pgDir 'bin'
$pgData = Join-Path $Root 'data\pg'
$secretsFile = Join-Path $Root 'config\secrets.json'
$secrets = $null
if (Test-Path $secretsFile) { $secrets = Get-Content $secretsFile -Raw | ConvertFrom-Json }
if (-not $secrets) {
  $secrets = [pscustomobject]@{ pgSuperPassword = (New-Secret 18); pgAppPassword = (New-Secret 18); jwtSecret = (New-Secret 48); pgPort = 5432 }
}

if (-not (Test-Path (Join-Path $pgBin 'postgres.exe'))) {
  if ($systemPg -and -not $PostgresZip) {
    # Our own copy, so ShopPOS keeps working even if that PostgreSQL is removed or upgraded.
    Info "Copying PostgreSQL $($systemPg.Version) from $($systemPg.Dir)..."
    foreach ($part in 'bin', 'lib', 'share') {
      robocopy (Join-Path $systemPg.Dir $part) (Join-Path $pgDir $part) /E /NFL /NDL /NJH /NJS /NP | Out-Null
      if ($LASTEXITCODE -ge 8) { Fail "Could not copy PostgreSQL ($part)." }
    }
  } else {
    $zip = $PostgresZip
    if (-not $zip) {
      $zip = Get-ChildItem $vendor -Filter 'postgresql-*-windows-x64-binaries.zip' -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
    }
    if ($zip -and -not (Test-Zip $zip)) { Warn "$zip is damaged; downloading again."; Remove-Item $zip -Force; $zip = $null }
    if (-not $zip) {
      Info 'Downloading PostgreSQL (about 340 MB, this can take several minutes)...'
      $urls = @()
      foreach ($v in $PostgresVersions) {
        $file = "postgresql-$v-windows-x64-binaries.zip"
        $url = "https://get.enterprisedb.com/postgresql/$file"
        $urls += $url
        $zip = Save-Url $url (Join-Path $vendor $file) 200MB
        if ($zip -and (Test-Zip $zip)) { break }
        $zip = $null
      }
      if (-not $zip) {
        Show-DownloadHelp 'PostgreSQL' ($urls + 'https://www.enterprisedb.com/download-postgresql-binaries') 'Windows x86-64 "binaries" zip, version 17'
      }
    }
    Info 'Unpacking PostgreSQL...'
    $tmp = Join-Path $Root 'tmp-pg'
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Zip $zip $tmp
    $inner = Join-Path $tmp 'pgsql'
    if (-not (Test-Path (Join-Path $inner 'bin\postgres.exe'))) { Fail "$zip is not a PostgreSQL binaries zip (no pgsql\bin\postgres.exe inside)." }
    # A half-finished folder from an earlier failed install is replaced.
    Remove-Item $pgDir -Recurse -Force -ErrorAction SilentlyContinue
    Move-Item $inner $pgDir
    Remove-Item $tmp -Recurse -Force
  }
}
$pgCheck = Invoke-Native (Join-Path $pgBin 'pg_ctl.exe') @('--version') 'pg-version'
$pgVersionText = $pgCheck.Text
if ($pgCheck.Code -ne 0) {
  # Usually the Microsoft Visual C++ runtime is missing on a fresh Windows: install it and try again.
  Warn 'PostgreSQL needs the Microsoft Visual C++ runtime. Installing it...'
  $vcUrl = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
  $vc = Get-ChildItem $vendor -Filter 'vc_redist.x64.exe' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
  if (-not $vc) { $vc = Save-Url $vcUrl (Join-Path $vendor 'vc_redist.x64.exe') 5MB }
  if (-not $vc) { Show-DownloadHelp 'the Microsoft Visual C++ runtime' @($vcUrl) 'vc_redist.x64.exe' }
  $p = Start-Process -FilePath $vc -ArgumentList '/install', '/quiet', '/norestart' -Wait -PassThru
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010 -and $p.ExitCode -ne 1638) {
    Fail "The Visual C++ runtime did not install (code $($p.ExitCode)). Run $vc by hand, then INSTALL.cmd again."
  }
  $pgCheck = Invoke-Native (Join-Path $pgBin 'pg_ctl.exe') @('--version') 'pg-version'
  $pgVersionText = $pgCheck.Text
  if ($pgCheck.Code -ne 0) { Fail "PostgreSQL does not start on this computer (code $($pgCheck.Code)): $pgVersionText" }
}
Ok "$pgVersionText"

# A database folder made by another PostgreSQL major version cannot be opened.
$pgDataVersion = Join-Path $pgData 'PG_VERSION'
if ((Test-Path $pgDataVersion) -and ($pgVersionText -match '(\d+)\.')) {
  $dataMajor = (Get-Content $pgDataVersion -Raw).Trim()
  if ($dataMajor -ne $Matches[1]) {
    Fail "The existing database was made with PostgreSQL $dataMajor but this is PostgreSQL $($Matches[1]). Use a PostgreSQL $dataMajor zip (-PostgresZip)."
  }
}

if (-not (Get-Service ShopPOS-DB -ErrorAction SilentlyContinue)) {
  if (-not (Test-Path $pgDataVersion)) {
    # Use 5432 unless another PostgreSQL already uses it.
    if (Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue) { $secrets.pgPort = 5433 }
    # A folder left by an earlier failed attempt (no PG_VERSION inside) is moved aside, never deleted.
    if ((Test-Path $pgData) -and (Get-ChildItem $pgData -Force -ErrorAction SilentlyContinue)) {
      $aside = "$pgData-failed-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
      Warn "Moving an unfinished database folder aside: $aside"
      Move-Item $pgData $aside
    }
    New-Item -ItemType Directory -Force -Path $pgData | Out-Null

    # PostgreSQL never runs with administrator rights: initdb drops them and works as this Windows
    # user alone. So this user (and the database service account) must be allowed to write here.
    $me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    icacls $pgData /grant "*${me}:(OI)(CI)F" "${NetSvc}:(OI)(CI)F" /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "Could not set permissions on $pgData." }

    # The password file goes inside the folder initdb can read, and is removed right after.
    $pwFile = Join-Path $Root 'data\initdb-pw.txt'
    Set-Content -Path $pwFile -Value $secrets.pgSuperPassword -NoNewline -Encoding ascii
    icacls $pwFile /grant "*${me}:R" /Q | Out-Null
    Info 'Creating the database folder (initdb)...'
    $init = Invoke-Native (Join-Path $pgBin 'initdb.exe') @(
      '-D', $pgData, '-U', 'postgres', '-A', 'scram-sha-256', "--pwfile=$pwFile", '-E', 'UTF8', '--locale=C'
    ) 'initdb'
    Remove-Item $pwFile -Force -ErrorAction SilentlyContinue
    if ($init.Code -ne 0) {
      Write-Host ''
      foreach ($line in ($init.Lines | Select-Object -Last 15)) { Write-Host "    $line" -ForegroundColor Red }
      Fail "Could not create the database folder (initdb, code $($init.Code)). The PostgreSQL message is shown above and saved in $Root\logs\initdb.log."
    }
    Ok 'Database folder created'

    # Settings for an i3 laptop with 8 GB of RAM.
    Add-Content (Join-Path $pgData 'postgresql.conf') @"

# --- ShopPOS ---
listen_addresses = 'localhost'
port = $($secrets.pgPort)
max_connections = 40
shared_buffers = 256MB
effective_cache_size = 1GB
work_mem = 8MB
maintenance_work_mem = 128MB
wal_compression = on
log_destination = 'stderr'
logging_collector = on
log_directory = '$(($Root + '\logs') -replace '\\', '/')'
log_filename = 'postgresql-%a.log'
log_truncate_on_rotation = on
"@
  }
  icacls $pgData /grant "${NetSvc}:(OI)(CI)F" /T /Q | Out-Null
  icacls (Join-Path $Root 'logs') /grant "${NetSvc}:(OI)(CI)M" /T /Q | Out-Null
  $reg = Invoke-Native (Join-Path $pgBin 'pg_ctl.exe') @(
    'register', '-N', 'ShopPOS-DB', '-D', $pgData, '-S', 'auto', '-U', 'NT AUTHORITY\NetworkService'
  ) 'pg-register'
  if ($reg.Code -ne 0) { Fail "Could not register the database service: $($reg.Text)" }
}
Set-Content -Path $secretsFile -Value ($secrets | ConvertTo-Json) -Encoding utf8
icacls $secretsFile /inheritance:r /grant:r "${Admins}:F" "${System}:F" /Q | Out-Null

try { Start-Service ShopPOS-DB } catch {
  Fail "The database service did not start: $($_.Exception.Message). See $Root\logs\postgresql-*.log and Windows Event Viewer > Application."
}
$env:PGPASSWORD = $secrets.pgSuperPassword
Wait-Until { & (Join-Path $pgBin 'pg_isready.exe') -h localhost -p $secrets.pgPort -q; $LASTEXITCODE -eq 0 } 60 'The database'
$psql = Join-Path $pgBin 'psql.exe'
$roleExists = & $psql -h localhost -p $secrets.pgPort -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='pos'"
if ($roleExists -ne '1') {
  & $psql -h localhost -p $secrets.pgPort -U postgres -qc "CREATE ROLE pos LOGIN PASSWORD '$($secrets.pgAppPassword)'" | Out-Null
}
$dbExists = & $psql -h localhost -p $secrets.pgPort -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='shoppos'"
if ($dbExists -ne '1') {
  & $psql -h localhost -p $secrets.pgPort -U postgres -qc 'CREATE DATABASE shoppos OWNER pos' | Out-Null
}
Remove-Item Env:PGPASSWORD
Ok "PostgreSQL running (service ShopPOS-DB, port $($secrets.pgPort))"

# ── 3. App files and configuration ────────────────────────────────────────
Step 'ShopPOS app'
if (Get-Service ShopPOS -ErrorAction SilentlyContinue) { Stop-Service ShopPOS -ErrorAction SilentlyContinue }
robocopy (Join-Path $Here 'app') (Join-Path $Root 'app') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Fail 'Copying the app files failed.' }
Copy-Item (Join-Path $Here 'start-pos.ps1') (Join-Path $Root 'start-pos.ps1') -Force
Copy-Item (Join-Path $Here 'uninstall.ps1') (Join-Path $Root 'uninstall.ps1') -Force

# HTTPS: a certificate authority for this laptop only. Windows (and so Chrome/Edge) trusts it,
# so https://pos.shop shows the padlock without internet. The private keys stay admin-only.
Step 'HTTPS certificate'
$tlsDir = Join-Path $Root 'config\tls'
New-Item -ItemType Directory -Force -Path $tlsDir | Out-Null
icacls $tlsDir /inheritance:r /grant:r "${Admins}:(OI)(CI)F" "${System}:(OI)(CI)F" /Q | Out-Null
$tls = Invoke-Native $nodeExe @((Join-Path $Root 'app\api\dist\cli\tls.js'), $tlsDir, $HostName) 'tls'
foreach ($line in $tls.Lines) { Info $line }
if ($tls.Code -ne 0) { Fail "Could not create the HTTPS certificate: $($tls.Text)" }
$caFile = Join-Path $tlsDir 'ca.crt'
$caCert = New-Object Security.Cryptography.X509Certificates.X509Certificate2($caFile)
Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Subject -like '*ShopPOS Local CA*' -and $_.Thumbprint -ne $caCert.Thumbprint } |
  Remove-Item -ErrorAction SilentlyContinue
if (-not (Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Thumbprint -eq $caCert.Thumbprint })) {
  Import-Certificate -FilePath $caFile -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
}
Ok "Windows trusts the ShopPOS certificate ($SiteUrl shows a padlock)"

$envFile = Join-Path $Root 'config\shoppos.env'
$storage = Join-Path $Root 'data\storage'
@"
# ShopPOS settings (written by install.ps1). Keep this file private.
NODE_ENV=production
PORT=$HttpsPort
HTTP_PORT=$Port
HOST=127.0.0.1
TLS_DIR=$tlsDir
TLS_HOST=$HostName
DATABASE_URL=postgresql://pos:$($secrets.pgAppPassword)@localhost:$($secrets.pgPort)/shoppos
JWT_SECRET=$($secrets.jwtSecret)
WEB_DIST_DIR=$(Join-Path $Root 'app\web\dist')
STORAGE_DIR=$storage
BACKUP_DIR=$(Join-Path $Root 'backups')
PG_BIN_DIR=$pgBin
"@ | Set-Content -Path $envFile -Encoding ascii
icacls $envFile /inheritance:r /grant:r "${Admins}:F" "${System}:F" /Q | Out-Null

$env:DOTENV_CONFIG_PATH = $envFile
Push-Location (Join-Path $Root 'app\api')
try {
  & $nodeExe 'dist\cli\migrate.js'
  if ($LASTEXITCODE -ne 0) { Fail 'The database update failed (see the message above).' }
  if ($SampleData) { $env:SEED_MODE = 'sample' } else { $env:SEED_MODE = 'minimal' }
  $env:SEED_ADMIN_PASSWORD = $AdminPassword
  $env:SEED_ADMIN_PIN = $AdminPin
  $env:SEED_SUPERADMIN_PASSWORD = $SuperAdminPassword
  $env:SEED_SUPERADMIN_PIN = $SuperAdminPin
  & $nodeExe 'dist\cli\seed.js'
  if ($LASTEXITCODE -ne 0) { Fail 'Could not create the first accounts.' }
} finally {
  Pop-Location
  foreach ($v in 'DOTENV_CONFIG_PATH', 'SEED_MODE', 'SEED_ADMIN_PASSWORD', 'SEED_ADMIN_PIN', 'SEED_SUPERADMIN_PASSWORD', 'SEED_SUPERADMIN_PIN') {
    Remove-Item "Env:$v" -ErrorAction SilentlyContinue
  }
}
Ok 'Database ready'

# ── 4. Windows service for the POS server ─────────────────────────────────
Step 'Windows service'
$serviceExe = Join-Path $Root 'service\ShopPOS.exe'
if (-not (Test-Path $serviceExe)) {
  # WinSW turns the Node.js server into a Windows service. The x64 build also runs on ARM64 Windows 11.
  $winsw = Get-ChildItem $vendor -Filter 'WinSW-x64*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
  if (-not $winsw) {
    $winswUrl = "https://github.com/winsw/winsw/releases/download/$WinSWVersion/WinSW-x64.exe"
    $winsw = Save-Url $winswUrl (Join-Path $vendor "WinSW-x64-$WinSWVersion.exe") 1MB
    if (-not $winsw) { Show-DownloadHelp 'WinSW (the service helper)' @($winswUrl) 'WinSW-x64.exe' }
  }
  Copy-Item $winsw $serviceExe
}
@"
<service>
  <id>ShopPOS</id>
  <name>ShopPOS</name>
  <description>ShopPOS server (billing, stock and reports). Serves $SiteUrl</description>
  <executable>$nodeExe</executable>
  <arguments>dist\main.js</arguments>
  <workingdirectory>$(Join-Path $Root 'app\api')</workingdirectory>
  <env name="DOTENV_CONFIG_PATH" value="$envFile" />
  <startmode>Automatic</startmode>
  <depend>ShopPOS-DB</depend>
  <onfailure action="restart" delay="5 sec" />
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
  <resetfailure>1 hour</resetfailure>
  <stoptimeout>20 sec</stoptimeout>
  <logpath>$(Join-Path $Root 'logs')</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
</service>
"@ | Set-Content -Path (Join-Path $Root 'service\ShopPOS.xml') -Encoding utf8

if (-not (Get-Service ShopPOS -ErrorAction SilentlyContinue)) {
  & $serviceExe install | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail 'Could not install the ShopPOS service.' }
}
Start-Service ShopPOS
$healthUrl = "https://127.0.0.1:$HttpsPort/api/health"
Wait-Until {
  try { (Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $false }
} 60 'The POS server'
Ok 'POS server running (service ShopPOS)'

# ── 5. pos.shop address ───────────────────────────────────────────────────
Step "Address $SiteUrl"
$hosts = "$env:SystemRoot\System32\drivers\etc\hosts"
$hostsText = Get-Content $hosts -Raw -ErrorAction SilentlyContinue
if ($hostsText -notmatch "(?m)^\s*127\.0\.0\.1\s+$([regex]::Escape($HostName))\s*$") {
  try {
    Add-Content -Path $hosts -Value "`r`n127.0.0.1 $HostName" -Encoding ascii
    Ok "Added $HostName to the hosts file"
  } catch {
    Warn "Could not edit the hosts file (antivirus?). Add this line by hand: 127.0.0.1 $HostName"
  }
} else { Ok 'Already set' }
ipconfig /flushdns | Out-Null

# ── 6. Chrome kiosk at Windows start ──────────────────────────────────────
if (-not $NoKiosk) {
  Step 'Kiosk (full screen)'
  $chrome = $chromePath
  if (-not $chrome) {
    Warn 'Neither Chrome nor Edge was found. Install Google Chrome, then run this installer again.'
  } else {
    @{ chrome = $chrome; url = $SiteUrl; health = $healthUrl } | ConvertTo-Json |
      Set-Content -Path (Join-Path $Root 'config\kiosk.json') -Encoding utf8
    $shell = New-Object -ComObject WScript.Shell
    $targets = @(
      (Join-Path ([Environment]::GetFolderPath('CommonStartup')) 'ShopPOS.lnk'),
      (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'ShopPOS.lnk')
    )
    foreach ($lnk in $targets) {
      $s = $shell.CreateShortcut($lnk)
      $s.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
      $s.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Root\start-pos.ps1`""
      $s.IconLocation = "$chrome,0"
      $s.Description = 'Open ShopPOS'
      $s.Save()
    }
    Ok "$(Split-Path $chrome -Leaf) opens ShopPOS full screen at every Windows start (and from the desktop icon)"
    Info 'To leave full screen: user menu > Exit full-screen POS, or press Alt+F4.'
  }
}

Write-Host ''
Write-Host '  ShopPOS is installed.' -ForegroundColor Green
Write-Host "  Open: $SiteUrl   (or double-click 'ShopPOS' on the desktop)"
if (-not $firstInstall) {
  Write-Host '  Existing users, passwords and data were kept.'
} elseif ($testPasswords) {
  Write-Host "  Shop owner:  PIN $AdminPin   (username admin / $AdminPassword)"
  Write-Host "  Super Admin: username superadmin / $SuperAdminPassword"
  Write-Host '  These are TEST passwords. Change them under My profile before real use.' -ForegroundColor Yellow
} else {
  Write-Host '  Log in as "admin" (shop owner) or "superadmin" with the passwords you chose.'
}
Write-Host "  Backups: $Root\backups (daily at 21:30 and when the day is closed; add a USB folder on the Backups page)"
Write-Host '  To update later: run UPDATE.cmd from the new package.'
Write-Host "  Logs: $Root\logs"
Write-Host ''
try { Stop-Transcript | Out-Null } catch { }
