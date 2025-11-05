<#  tools/fix-and-push.ps1
    Cleans nested .backup folders (long paths), updates .gitignore,
    stages changes, commits, and pushes to origin/main.
#>

param(
  [string]$Message = "Deploy: prod push (purged .backup, stage + commit)"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Info($msg) { Write-Host "[info] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[ ok ] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[warn] $msg" -ForegroundColor Yellow }

# 1) Ensure Git supports long paths (Windows)
Write-Info "Enabling git longpaths"
git config core.longpaths true

# 2) Ensure .gitignore excludes .backup
$gitignorePath = ".gitignore"
$linesToEnsure = @(
  ".backup/",
  ".backup*",
  "*.tmp",
  "*.bak"
)

if (-not (Test-Path $gitignorePath)) {
  Write-Info "Creating .gitignore"
  New-Item -ItemType File -Path $gitignorePath | Out-Null
}

$existing = Get-Content $gitignorePath -ErrorAction SilentlyContinue
$append = @()
foreach ($l in $linesToEnsure) {
  if ($existing -notcontains $l) { $append += $l }
}
if ($append.Count -gt 0) {
  Write-Info "Updating .gitignore"
  Add-Content -Path $gitignorePath -Value ($append -join "`n")
} else {
  Write-Info ".gitignore already has required rules"
}

# 3) Remove the problematic .backup directory using long-path prefix
$backupPath = (Resolve-Path ".").Path + "\.backup"
$lp = "\\?\$backupPath"
if (Test-Path $lp) {
  Write-Warn "Removing .backup recursively (long-path aware)"
  try {
    # Sometimes OneDrive locks files; retry a couple of times
    for ($i=1; $i -le 3; $i++) {
      try {
        Remove-Item -LiteralPath $lp -Recurse -Force -ErrorAction Stop
        break
      } catch {
        Start-Sleep -Seconds 2
        if ($i -eq 3) { throw }
      }
    }
    Write-Ok ".backup removed"
  } catch {
    Write-Warn "PowerShell removal failed, trying cmd rd"
    cmd /c "rd /s /q `"$backupPath`""
    if (Test-Path $lp) { throw "Failed to delete $backupPath" }
    Write-Ok ".backup removed via cmd"
  }
} else {
  Write-Info "No .backup folder to remove"
}

# 4) Stage, commit, push
Write-Info "Staging all changes"
git add -A

# Check if anything staged
$hasChanges = $LASTEXITCODE -eq 0 -and (!(git diff --cached --quiet))
if ($hasChanges) {
  Write-Info "Committing"
  git commit -m $Message | Out-Null
} else {
  Write-Info "Nothing new to commit; proceeding to push"
}

Write-Info "Pushing to origin/main"
git push origin main

Write-Ok "Done. If Vercel is linked, this triggers a prod deploy."
