# ChainLock + SENTINEL - one-command launcher for Windows (PowerShell 5.1+ / PowerShell 7).
#
#   From anywhere (downloads everything), in PowerShell:
#     powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/aryansingh32/chainlock-sentinel/main/start.ps1 | iex"
#   Inside a checkout: double-click start.bat   (or: powershell -ExecutionPolicy Bypass -File start.ps1)
#
# What it does:
#   1. Gets the code (if not already inside the repo) - no git needed.
#   2. Uses your Node.js >= 20.19, or downloads a portable Node 22 into .tools\ (no admin rights).
#   3. Installs web dependencies (npm).
#   4. Creates backend\.venv and installs the Python Crypto Core (real ML-DSA / ML-KEM / SLH-DSA).
#      No Python 3.10+? It tries winget; otherwise the app runs with simulated signatures.
#   5. Starts the Crypto Core on :8000 and the web app on :5173, then opens your browser.
#   Ctrl+C (or closing the window) stops everything.
#
# Options (environment variables): WEB_PORT, API_PORT, NO_BACKEND=1, NO_BROWSER=1, INSTALL_DIR

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Repo = 'aryansingh32/chainlock-sentinel'
$Branch = if ($env:BRANCH) { $env:BRANCH } else { 'main' }
$NodeVersion = if ($env:NODE_VERSION) { $env:NODE_VERSION } else { '22.22.2' }
$WebPort = if ($env:WEB_PORT) { $env:WEB_PORT } else { '5173' }
$ApiPort = if ($env:API_PORT) { $env:API_PORT } else { '8000' }

function Say($m) { Write-Host "[chainlock] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[chainlock] $m" -ForegroundColor Yellow }
function Die($m) { Write-Host "[chainlock] $m" -ForegroundColor Red; exit 1 }
function Have($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }

# ---------------------------------------------------------------- 1. code
$Root = $null
if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot 'package.json')) -and (Test-Path (Join-Path $PSScriptRoot 'backend'))) {
  $Root = $PSScriptRoot
} else {
  $Root = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { Join-Path (Get-Location) 'chainlock-sentinel' }
  if (Test-Path (Join-Path $Root 'package.json')) {
    Say "Using existing copy in $Root"
  } else {
    Say "Downloading $Repo ($Branch) into $Root"
    $tmp = Join-Path $env:TEMP ("chainlock-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $tmp | Out-Null
    Invoke-WebRequest "https://github.com/$Repo/archive/refs/heads/$Branch.zip" -OutFile "$tmp\src.zip" -UseBasicParsing
    Expand-Archive "$tmp\src.zip" -DestinationPath $tmp -Force
    $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
    New-Item -ItemType Directory -Path $Root -Force | Out-Null
    Get-ChildItem $inner.FullName -Force | Move-Item -Destination $Root -Force
    Remove-Item $tmp -Recurse -Force
  }
}
Set-Location $Root
Say "Project: $Root"

# ---------------------------------------------------------------- 2. Node.js
function Test-Node {
  if (-not (Have 'node')) { return $false }
  try { $v = (& node -p 'process.versions.node').Trim() } catch { return $false }
  $p = $v.Split('.'); $maj = [int]$p[0]; $min = [int]$p[1]
  # Vite 8 needs Node ^20.19 or >= 22.12
  return ($maj -ge 23) -or ($maj -eq 22 -and $min -ge 12) -or ($maj -eq 20 -and $min -ge 19)
}
$PortableNode = Join-Path $Root '.tools\node'
if (Test-Path "$PortableNode\node.exe") { $env:Path = "$PortableNode;$env:Path" }
if (-not (Test-Node)) {
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $name = "node-v$NodeVersion-win-$arch"
  Say "Node.js >= 20.19 not found - downloading portable $name (no admin rights needed)"
  New-Item -ItemType Directory -Path "$Root\.tools" -Force | Out-Null
  Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/$name.zip" -OutFile "$Root\.tools\node.zip" -UseBasicParsing
  if (Test-Path $PortableNode) { Remove-Item $PortableNode -Recurse -Force }
  Expand-Archive "$Root\.tools\node.zip" -DestinationPath "$Root\.tools" -Force
  Rename-Item "$Root\.tools\$name" 'node'
  Remove-Item "$Root\.tools\node.zip"
  $env:Path = "$PortableNode;$env:Path"
  if (-not (Test-Node)) { Die 'Portable Node failed to start' }
}
Say "Node $(& node -v) / npm $(& npm.cmd -v)"

# ---------------------------------------------------------------- 3. web deps
$marker = Join-Path $Root 'node_modules\.chainlock-installed'
$needInstall = -not (Test-Path "$Root\node_modules\.bin\vite.cmd")
if (-not $needInstall -and (Test-Path $marker)) { $needInstall = (Get-Item "$Root\package.json").LastWriteTime -gt (Get-Item $marker).LastWriteTime }
elseif (-not (Test-Path $marker)) { $needInstall = $true }
if ($needInstall) {
  Say 'Installing web dependencies (first run takes a minute)...'
  & npm.cmd install --no-fund --no-audit --loglevel=error
  if ($LASTEXITCODE -ne 0) { Die 'npm install failed' }
  New-Item -ItemType File -Path $marker -Force | Out-Null
} else { Say 'Web dependencies already installed' }

# ---------------------------------------------------------------- 4. Python Crypto Core
function Find-Python {
  $cands = @(@('py', '-3'), @('python'), @('python3'))
  foreach ($c in $cands) {
    if (-not (Have $c[0])) { continue }
    $args2 = @(); if ($c.Length -gt 1) { $args2 += $c[1] }
    try {
      # The Microsoft Store "python" alias prints nothing useful - verify the version for real.
      & $c[0] @args2 -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)' 2>$null
      if ($LASTEXITCODE -eq 0) { return , $c }
    } catch { }
  }
  return $null
}

$backend = $null
$web = $null
try {
  if ($env:NO_BACKEND -ne '1') {
    $py = Find-Python
    if (-not $py -and (Have 'winget')) {
      Say 'Python 3.10+ not found - installing Python 3.12 with winget (you may see a prompt)...'
      & winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements | Out-Null
      $env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + $env:Path
      $py = Find-Python
    }
    if (-not $py) {
      Warn 'Python 3.10+ not found. Install it from https://www.python.org/downloads/ for real post-quantum signatures.'
      Warn 'Continuing in SIMULATED crypto mode.'
    } else {
      $venvPy = Join-Path $Root 'backend\.venv\Scripts\python.exe'
      if (-not (Test-Path $venvPy)) {
        Say 'Creating Python virtual environment'
        $pyArgs = @(); if ($py.Length -gt 1) { $pyArgs += $py[1] }
        & $py[0] @pyArgs -m venv "$Root\backend\.venv"
        if ($LASTEXITCODE -ne 0) { Die 'Could not create the Python virtual environment' }
      }
      $pyMarker = Join-Path $Root 'backend\.venv\.installed'
      if (-not (Test-Path $pyMarker) -or (Get-Item "$Root\backend\requirements.txt").LastWriteTime -gt (Get-Item $pyMarker).LastWriteTime) {
        Say 'Installing Crypto Core packages...'
        & $venvPy -m pip install -q --upgrade pip
        & $venvPy -m pip install -q -r "$Root\backend\requirements.txt"
        if ($LASTEXITCODE -ne 0) { Die 'pip install failed' }
        New-Item -ItemType File -Path $pyMarker -Force | Out-Null
      }
      Say "Starting Crypto Core on http://127.0.0.1:$ApiPort (docs at /docs)"
      $backend = Start-Process -FilePath $venvPy -ArgumentList @('-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', $ApiPort, '--log-level', 'warning') -WorkingDirectory "$Root\backend" -NoNewWindow -PassThru
    }
  }

  # ---------------------------------------------------------------- 5. web app
  Say "Starting web app on http://localhost:$WebPort"
  $env:VITE_CRYPTO_CORE_URL = "http://127.0.0.1:$ApiPort"
  $web = Start-Process -FilePath "$Root\node_modules\.bin\vite.cmd" -ArgumentList @('dev', '--host', '127.0.0.1', '--port', $WebPort, '--strictPort') -WorkingDirectory $Root -NoNewWindow -PassThru

  $url = "http://localhost:$WebPort/"
  $ready = $false
  for ($i = 0; $i -lt 120 -and -not $ready; $i++) {
    if ($web.HasExited) { Die "Web app failed to start (is port $WebPort in use? set WEB_PORT=5174)" }
    try { Invoke-WebRequest "http://127.0.0.1:$WebPort/" -UseBasicParsing -TimeoutSec 2 | Out-Null; $ready = $true } catch { Start-Sleep -Seconds 1 }
  }

  Write-Host ''
  Write-Host '  ChainLock + SENTINEL is running' -ForegroundColor Green
  Write-Host "  Web app     : $url"
  if ($backend) { Write-Host "  Crypto Core : http://127.0.0.1:$ApiPort/docs  (LIVE post-quantum crypto)" } else { Write-Host '  Crypto Core : not running - SIMULATED signatures' }
  Write-Host '  Demo panel  : press D in the app - Jury script: Briefing page'
  Write-Host '  Stop        : Ctrl+C'
  Write-Host ''

  if ($env:NO_BROWSER -ne '1') { Start-Process $url }
  Wait-Process -Id $web.Id
} finally {
  foreach ($p in @($web, $backend)) {
    if ($p -and -not $p.HasExited) {
      # vite.cmd spawns node children - stop the whole tree
      & taskkill.exe /PID $p.Id /T /F 2>$null | Out-Null
    }
  }
}
