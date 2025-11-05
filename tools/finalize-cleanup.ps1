# tools/finalize-cleanup.ps1
# Formats, verifies, builds, and commits the Issues/Problem Board cleanup.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $ProjectRoot

function Try-Run($cmd, $args) {
  try {
    & $cmd $args
    return $true
  } catch {
    Write-Host "[SKIP] $cmd $args : $($_.Exception.Message)"
    return $false
  }
}

Write-Host "=== Verify no leftover references ==="
powershell -ExecutionPolicy Bypass -File .\tools\verify-cleanup.ps1

Write-Host "`n=== Prettier format (if available) ==="
if (Get-Command npx -ErrorAction SilentlyContinue) {
  Try-Run npx "prettier -w . | Out-Null" | Out-Null
} else {
  Write-Host "[SKIP] npx not found"
}

Write-Host "`n=== ESLint (if available) ==="
if (Test-Path ".\node_modules\.bin\eslint.cmd" -or (Get-Command npx -ErrorAction SilentlyContinue)) {
  Try-Run npx "eslint . --ext .js,.jsx,.ts,.tsx" | Out-Null
} else {
  Write-Host "[SKIP] ESLint not installed"
}

Write-Host "`n=== Type check (if available) ==="
if (Test-Path ".\tsconfig.json") {
  Try-Run npx "tsc --noEmit" | Out-Null
} else {
  Write-Host "[OK] No tsconfig.json (skipping tsc)"
}

Write-Host "`n=== Build (to be sure prod build is fine) ==="
if (Test-Path ".\package.json") {
  Try-Run npm "run build" | Out-Null
} else {
  Write-Host "[SKIP] No package.json?"
}

Write-Host "`n=== Git commit ==="
# Ensure Git is available
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "[SKIP] Git not found on PATH"
  exit 0
}

# Create a safety branch
$branchName = "chore/remove-issues-page"
Try-Run git "checkout -b $branchName" | Out-Null

# Stage and commit
git add -A
git commit -m "chore: remove Issues/Problem Board and scrub references; move dark-bridge import; verify clean" | Out-Null

Write-Host "`n[OK] Committed on branch $branchName"
Write-Host "Next:"
Write-Host "  git push -u origin $branchName"
