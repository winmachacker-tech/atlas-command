<# tools\fix_migration_duplicate.ps1
   Purpose: Fix "duplicate key value violates unique constraint schema_migrations_pkey (version=20251111)"
            by renaming any local migration files that start with the duplicate version to a fresh timestamp,
            then pushing migrations via npx.
#>

param(
  [string]$ProjectPath = "C:\Users\mtish\OneDrive\Desktop\atlas-command",
  [string]$DuplicateVersion = "20251111"   # the version reported by the error
)

$ErrorActionPreference = "Stop"

function Write-Info($m){ Write-Host "[INFO]  $m" -ForegroundColor Cyan }
function Write-Warn($m){ Write-Host "[WARN]  $m" -ForegroundColor Yellow }
function Write-Err ($m){ Write-Host "[ERROR] $m" -ForegroundColor Red }

# 1) Locate migrations folder
$migrations = Join-Path $ProjectPath "supabase\migrations"
if (-not (Test-Path $migrations)) {
  Write-Err "Migrations folder not found: $migrations"
  exit 1
}

Write-Info "Scanning for migrations starting with version $DuplicateVersion…"
$dupes = Get-ChildItem -Path $migrations -Filter "*.sql" -Recurse |
  Where-Object { $_.Name -match '^\d{14}_.+\.sql$' -and $_.Name.StartsWith($DuplicateVersion) }

if ($dupes.Count -eq 0) {
  Write-Warn "No local files found that start with $DuplicateVersion.
If the error persists, another file may share the same numeric prefix. Re-run with that version."
  exit 0
}

# 2) Rename each duplicate to a fresh unique timestamp
function New-UniqueVersion {
  # Generate a yyyyMMddHHmmss; wait a tick if collision
  do {
    $v = (Get-Date).ToString("yyyyMMddHHmmss")
    Start-Sleep -Milliseconds 200
  } while (Test-Path (Join-Path $migrations ($v + "_placeholder.sql")))
  return $v
}

$renamed = @()
foreach ($f in $dupes) {
  $name = $f.Name
  $underscore = $name.IndexOf("_")
  if ($underscore -lt 14) {
    Write-Warn "Skipping oddly named migration: $name"
    continue
  }
  $suffix = $name.Substring($underscore)   # includes leading "_"
  $newVersion = New-UniqueVersion
  $newName = "$newVersion$suffix"
  $newPath = Join-Path $f.DirectoryName $newName
  Write-Info "Renaming `"$name`" → `"$newName`""
  Rename-Item -Path $f.FullName -NewName $newName
  $renamed += $newPath
}

if ($renamed.Count -gt 0) {
  Write-Info "Renamed $($renamed.Count) file(s)."
} else {
  Write-Warn "Nothing renamed."
}

# 3) Push migrations using npx (no global install required)
Write-Info "Linking project (if needed) and pushing migrations…"
Push-Location $ProjectPath
try {
  npx supabase link --project-ref tnpesnohwbwpmakvyzpn | Out-Host
} catch { Write-Warn "link may already exist; continuing…" }

# Add --debug so we can see details if it fails
npx supabase db push --debug | Out-Host
Pop-Location

Write-Info "Done. If you still see a duplicate error, note the new 'version=XXXXXXXXXXXXXX' it reports and re-run this script with -DuplicateVersion set to that number."
