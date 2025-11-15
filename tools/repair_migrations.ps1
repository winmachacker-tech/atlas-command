# FILE: tools/repair_migrations.ps1
# Purpose: Fix "Remote migration versions not found in local migrations directory"
# by creating local placeholder files for migrations that exist remotely.
# Usage:
#   1) Ensure psql is installed and on PATH.
#   2) Run:
#        pwsh ./tools/repair_migrations.ps1 -DbUrl "postgresql://USER:PASSWORD@HOST:PORT/dbname"
#   3) Then verify:
#        supabase migration status
# Notes:
# - This does NOT modify your remote DB. It only creates local placeholder files.
# - Placeholders are clearly labeled and empty (no-ops).

param(
  [Parameter(Mandatory = $true)]
  [string]$DbUrl,

  [string]$MigrationsDir = "supabase/migrations"
)

function Fail($msg) {
  Write-Host "ERROR: $msg" -ForegroundColor Red
  exit 1
}

# 0) Preconditions --------------------------------------------------------------
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  Fail "psql not found. Install PostgreSQL client tools or add psql to PATH."
}

if (-not (Test-Path $MigrationsDir)) {
  Fail "Migrations directory '$MigrationsDir' not found. Run from your repo root or set -MigrationsDir."
}

# 1) Read remote migration versions -------------------------------------------
Write-Host "Reading remote migration versions from Supabase..." -ForegroundColor Cyan
$remoteSql = "select version from supabase_migrations.schema_migrations order by version;"
try {
  $remoteVersions = & psql "$DbUrl" -Atc $remoteSql 2>$null
} catch {
  Fail "Could not query remote versions. Check -DbUrl and network access."
}

if (-not $remoteVersions) {
  Write-Host "No remote migrations found. Nothing to repair." -ForegroundColor Yellow
  exit 0
}

# 2) Read local migration versions (filenames before first underscore) ---------
Write-Host "Scanning local migrations in '$MigrationsDir'..." -ForegroundColor Cyan
$localFiles = Get-ChildItem -Path $MigrationsDir -Filter "*.sql" -File -Recurse
$localVersions = @{}
foreach ($f in $localFiles) {
  # Expected naming: YYYYMMDDHHMMSS_description.sql
  $name = $f.Name
  $ver = $name.Split("_")[0]
  if ($ver -match '^\d{14}$') {
    $localVersions[$ver] = $true
  }
}

# 3) Determine which remote versions are missing locally -----------------------
$missing = @()
foreach ($rv in $remoteVersions) {
  if (-not $localVersions.ContainsKey($rv)) {
    $missing += $rv
  }
}

if ($missing.Count -eq 0) {
  Write-Host "✅ Local migrations already match remote versions. No repair needed." -ForegroundColor Green
  exit 0
}

Write-Host ""
Write-Host "Found $($missing.Count) remote versions missing locally:" -ForegroundColor Yellow
$missing | ForEach-Object { Write-Host "  - $_" }

# 4) Create placeholder files --------------------------------------------------
Write-Host ""
Write-Host "Creating local placeholder files..." -ForegroundColor Cyan

$created = @()
foreach ($ver in $missing) {
  $placeholderName = "${ver}_remote_applied_placeholder.sql"
  $fullPath = Join-Path $MigrationsDir $placeholderName

  if (Test-Path $fullPath) {
    continue
  }

  $content = @"
-- PLACEHOLDER: This migration was applied remotely before local files existed.
-- Version: $ver
-- Created locally to reconcile 'Remote migration versions not found in local migrations directory'.
-- Intentionally left blank (no-op).
"@

  New-Item -ItemType File -Path $fullPath -Force | Out-Null
  Set-Content -Path $fullPath -Value $content -NoNewline
  $created += $placeholderName
}

if ($created.Count -gt 0) {
  Write-Host "✅ Created $($created.Count) placeholder migration(s):" -ForegroundColor Green
  $created | ForEach-Object { Write-Host "  - $_" }
} else {
  Write-Host "No new placeholders were needed." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Done. Next steps:" -ForegroundColor Cyan
Write-Host "  1) Verify status:   supabase migration status"
Write-Host "  2) Commit files:    git add supabase/migrations && git commit -m 'chore: reconcile remote migration versions'"
Write-Host "  3) Run new migrations normally (e.g., supabase db push)."
