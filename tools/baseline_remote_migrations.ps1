# FILE: tools/baseline_remote_migrations.ps1
# Purpose: Baseline remote Supabase migrations to match local files
# Usage:
#   powershell -ExecutionPolicy Bypass -File "./tools/baseline_remote_migrations.ps1" `
#     -DbUrl "postgresql://postgres:YOUR_PASSWORD@db.tnpesnohwbwpmakvyzpn.supabase.co:5432/postgres"

param(
  [Parameter(Mandatory = $true)]
  [string]$DbUrl,
  [string]$MigrationsDir = "supabase/migrations"
)

function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) { Fail "psql not found. Install PostgreSQL client tools and retry." }
if (-not (Test-Path $MigrationsDir)) { Fail "Migrations directory '$MigrationsDir' not found. Run from your repo root." }

# Collect local versions from filenames
$localFiles = Get-ChildItem -Path $MigrationsDir -Filter "*.sql" -File
$versions = @()
foreach ($f in $localFiles) {
  $ver = ($f.Name -split "_")[0]
  if ($ver -match '^\d{14}$') { $versions += $ver }
}

if ($versions.Count -eq 0) {
  Write-Host "No local migration files found. Nothing to baseline." -ForegroundColor Yellow
  exit 0
}

# Ensure the supabase_migrations schema/table exists (it should, but guard anyway)
$prepSql = @"
create schema if not exists supabase_migrations;

create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  inserted_at timestamptz default now()
);
"@

& psql "$DbUrl" -v "ON_ERROR_STOP=1" -Atc $prepSql 2>$null

# Insert any missing versions
# Build VALUES list for an INSERT ... ON CONFLICT DO NOTHING
$values = $versions | Sort-Object -Unique | ForEach-Object { "('$($_)')" } -join ","
$insertSql = @"
insert into supabase_migrations.schema_migrations(version)
values $values
on conflict (version) do nothing;
"@

Write-Host "Baselining remote migrations..." -ForegroundColor Cyan
& psql "$DbUrl" -v "ON_ERROR_STOP=1" -Atc $insertSql 2>$null

Write-Host "✅ Remote baseline complete." -ForegroundColor Green
Write-Host "Next steps:"
Write-Host "  1) supabase migration status"
Write-Host "  2) Commit if needed: git add supabase/migrations && git commit -m 'chore: baseline remote migrations'"
