<# 
  scripts/fix_migration_history.ps1
  Purpose: 
    - Quarantine non-conforming/ignored migration files out of supabase/migrations
    - Run Supabase "repair" steps as suggested by the CLI
    - Pull remote schema into a proper local migration file
    - Commit the result so Local and Remote histories align

  Usage:
    ./scripts/fix_migration_history.ps1
#>

param(
  [string]$MigrationsPath = "supabase/migrations",
  [string]$ProjectRef = "tnpesnohwbwpmakvyzpn"
)

function Ensure-Dir($p) {
  if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}

Write-Host "==> Checking migrations folder..."
if (-not (Test-Path $MigrationsPath)) {
  Write-Error "Migrations folder not found at '$MigrationsPath'. Run from repo root or adjust -MigrationsPath."
  exit 1
}

# 1) Quarantine ignored/badly named files so the CLI stops complaining
$drafts = Join-Path $MigrationsPath "_drafts"
Ensure-Dir $drafts

Write-Host "==> Moving ignored/non-conforming migration files to: $drafts"
$badFiles = Get-ChildItem -Path $MigrationsPath -File |
  Where-Object {
    $_.Name -match "\.ignore$" -or
    $_.Name -notmatch "^\d{8,}_.+\.sql$"  # Supabase requires <timestamp>_name.sql
  }

foreach ($f in $badFiles) {
  $dest = Join-Path $drafts $f.Name
  Write-Host ("    moving {0} -> _drafts/{0}" -f $f.Name)
  Move-Item -Force -Path $f.FullName -Destination $dest
}

# 2) Link (safe if already linked)
Write-Host "==> Linking project (no-op if already linked)..."
supabase link --project-ref $ProjectRef | Out-Host

# 3) Run the repair commands in the order the CLI suggested
Write-Host "==> Repairing migration history (marking versions applied/reverted so Local=Remote)..."

# Helper to run a repair line and continue on harmless errors
function Run-Repair($argsLine) {
  try {
    Write-Host ("    supabase migration repair {0}" -f $argsLine)
    supabase migration repair $argsLine | Out-Host
  } catch {
    Write-Warning ("      (ignored) " + $_.Exception.Message)
  }
}

# From your CLI output (order preserved):
Run-Repair "--status reverted 20251111"
Run-Repair "--status applied 20251111072304"
Run-Repair "--status applied 20251111"
Run-Repair "--status applied 20251111"
Run-Repair "--status applied 20251111"
Run-Repair "--status applied 20251111"
Run-Repair "--status applied 20251111"
Run-Repair "--status applied 20251111"
Run-Repair "--status applied 20251111"
Run-Repair "--status applied 20251111"
Run-Repair "--status applied 20251111"
Run-Repair "--status applied 20251111"
Run-Repair "--status applied 20251111"
Run-Repair "--status applied 20251111"
Run-Repair "--status applied 20251111"
Run-Repair "--status applied 20251112"
Run-Repair "--status applied 20251112"

# 4) Pull remote schema (now that histories are aligned, this should succeed)
Write-Host "==> Pulling remote schema into a proper local migration..."
supabase db pull | Out-Host

# 5) Commit the new migration locally
Write-Host "==> Committing pulled migration..."
git add $MigrationsPath
$diff = git diff --cached --name-only
if ([string]::IsNullOrWhiteSpace($diff)) {
  Write-Host "    No changes to commit."
} else {
  git commit -m "chore(db): sync remote schema after repair" | Out-Host
}

# 6) Show status
Write-Host "==> Current migration status:"
supabase migration list | Out-Host

Write-Host ""
Write-Host "Done."
Write-Host "Next steps:"
Write-Host "  1) Add your new migration (e.g., supabase/migrations/20251111_ai_predictions.sql)"
Write-Host "  2) Run: supabase db push"
