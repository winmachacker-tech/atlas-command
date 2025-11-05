# tools/dev-boot.ps1
<#
.SYNOPSIS
  Boots the dev environment reliably:
  - Verifies Node & npm
  - Installs deps (npm ci / pnpm / yarn based on lockfile)
  - Falls back to npx vite if needed
  - Starts the dev server

.USAGE
  powershell -File .\tools\dev-boot.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Say($t, $c='Gray'){ Write-Host $t -ForegroundColor $c }

# 1) Verify Node/npm
try {
  $nodeV = (node -v)
  $npmV  = (npm -v)
  Say "Node: $nodeV | npm: $npmV" 'Cyan'
} catch {
  Say "Node.js not found. Install Node 18+ (LTS) from nodejs.org and retry." 'Red'
  exit 1
}

# 2) Decide package manager by lockfile
$pm = "npm"
if (Test-Path ".\pnpm-lock.yaml") { $pm = "pnpm" }
elseif (Test-Path ".\yarn.lock")   { $pm = "yarn" }
elseif (Test-Path ".\package-lock.json") { $pm = "npm" }

Say "Using package manager: $pm" 'Cyan'

# 3) Install deps if needed (or if vite is missing)
$needInstall = $false
if (-not (Test-Path ".\node_modules")) { $needInstall = $true }
else {
  # check if vite binary exists
  if (-not (Test-Path ".\node_modules\.bin\vite.cmd")) { $needInstall = $true }
}

if ($needInstall) {
  Say "Installing dependencies..." 'Yellow'
  switch ($pm) {
    'pnpm' { pnpm install --frozen-lockfile }
    'yarn' { yarn install --frozen-lockfile }
    default {
      if (Test-Path ".\package-lock.json") { npm ci }
      else { npm install }
    }
  }
} else {
  Say "Dependencies already present." 'DarkGray'
}

# 4) Ensure vite is available (install if missing)
if (-not (Test-Path ".\node_modules\.bin\vite.cmd")) {
  Say "Vite not found in node_modules. Adding dev dependency..." 'Yellow'
  npm i -D vite @vitejs/plugin-react
}

# 5) Start dev (try script, fallback to npx vite)
# Prefer package script so env vars/scripts run as defined.
try {
  Say "Starting dev server: npm run dev" 'Green'
  npm run dev
} catch {
  Say "npm script failed; falling back to npx vite" 'Yellow'
  npx vite
}
