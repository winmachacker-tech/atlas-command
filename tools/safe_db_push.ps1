<#  tools\safe_db_push.ps1
    Purpose: Resolve Windows hangs during `supabase db push` (e.g., "Initializing…"),
             clear common file locks, relink the project, and push migrations with retries.
    Usage:   Right-click → Run with PowerShell OR:
             pwsh -File .\tools\safe_db_push.ps1 -ProjectPath "C:\Users\mtish\OneDrive\Desktop\atlas-command"

    Notes:
      - Non-destructive: does NOT reset your DB.
      - Kills Node/Vite/esbuild that often hold locks on Windows.
      - Stops OneDrive temporarily to avoid file locking on migrations folder.
      - Validates migration filenames follow "<timestamp>_name.sql".
#>

param(
  [string]$ProjectPath = "C:\Users\mtish\OneDrive\Desktop\atlas-command",
  [string]$ProjectRef  = "tnpesnohwbwpmakvyzpn",   # your Supabase project ref
  [int]$Retries        = 2,                        # additional retries after first attempt
  [switch]$SkipOneDriveStop                       # optional: don’t stop OneDrive
)

$ErrorActionPreference = "Stop"

function Write-Info($msg)  { Write-Host "[INFO]  $msg" -ForegroundColor Cyan }
function Write-Warn($msg)  { Write-Host "[WARN]  $msg" -ForegroundColor Yellow }
function Write-Err ($msg)  { Write-Host "[ERROR] $msg" -ForegroundColor Red }
function NowStr            { return (Get-Date).ToString("yyyyMMdd-HHmmss") }

# --- 0) Preconditions ---------------------------------------------------------
if (-not (Test-Path $ProjectPath)) {
  Write-Err "ProjectPath not found: $ProjectPath"
  exit 1
}

$logDir  = Join-Path $ProjectPath ".logs"
$newItem = New-Item -ItemType Directory -Path $logDir -Force -ErrorAction SilentlyContinue | Out-Null
$logFile = Join-Path $logDir ("supabase-push-" + (NowStr) + ".log")

Push-Location $ProjectPath

# --- 1) Kill common lock holders (Node/Vite/esbuild/psql) --------------------
Write-Info "Stopping common lock holders (node/vite/esbuild/psql)…"
$procs = "node","vite","esbuild","psql","postgres","vercel","supabase_darwin_amd64","supabase"
foreach ($p in $procs) {
  try {
    Get-Process -Name $p -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  } catch { }
}

# --- 2) Pause/stop OneDrive to avoid file locks on migrations -----------------
if (-not $SkipOneDriveStop) {
  Write-Info "Stopping OneDrive temporarily to avoid file locks…"
  try { Get-Process -Name OneDrive -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue } catch { }
} else {
  Write-Warn "Skipping OneDrive stop (per flag). If you see file lock issues, re-run without -SkipOneDriveStop."
}

# --- 3) Check Supabase CLI availability + version ----------------------------
Write-Info "Checking Supabase CLI…"
try {
  $supabaseVersion = (& supabase --version) 2>$null
  if (-not $supabaseVersion) { throw "Supabase CLI not found in PATH." }
  Write-Info "Supabase CLI: $supabaseVersion"
} catch {
  Write-Err "Supabase CLI not found. Install: https://supabase.com/docs/guides/cli"
  Pop-Location; exit 1
}

# --- 4) Quick migration filename sanity check --------------------------------
Write-Info "Validating migration filenames (supabase/migrations)…"
$migrationsPath = Join-Path $ProjectPath "supabase\migrations"
if (-not (Test-Path $migrationsPath)) {
  Write-Err "Migrations folder not found: $migrationsPath"
  Pop-Location; exit 1
}

$badFiles = Get-ChildItem -Path $migrationsPath -Filter *.sql -Recurse | Where-Object {
  # Must match: 14 digits timestamp + "_" + name + ".sql"
  $_.Name -notmatch '^\d{14}_.+\.sql$'
}
if ($badFiles.Count -gt 0) {
  Write-Warn "Found migrations with invalid names (rename before pushing):"
  $badFiles | ForEach-Object { Write-Warn (" - " + $_.FullName) }
  Write-Err "Fix migration filenames (e.g., 20251111050100_ai_auto_feedback.sql) and re-run."
  Pop-Location; exit 1
}

# --- 5) Ensure project is linked ---------------------------------------------
Write-Info "Ensuring Supabase project is linked…"
try {
  # If not linked, this will prompt; if already linked, it’s no-op
  & supabase link --project-ref $ProjectRef | Tee-Object -FilePath $logFile -Append
} catch {
  Write-Warn "Link may already exist or require re-auth. Trying auth refresh…"
  & supabase logout | Out-Null
  & supabase login  | Out-Null
  & supabase link --project-ref $ProjectRef | Tee-Object -FilePath $logFile -Append
}

# --- 6) Push with retries + hang detection -----------------------------------
function Invoke-PushAttempt([int]$attempt) {
  Write-Info "supabase db push (attempt $attempt)… (logs: $logFile)"
  $job = Start-Job -ScriptBlock {
    param($logFile)
    $env:NO_COLOR = "1"           # cleaner logs
    $env:SUPABASE_TELEMETRY_DISABLE = "1"
    supabase db push --debug 2>&1 | Tee-Object -FilePath $logFile -Append
  } -ArgumentList $logFile

  # Wait up to 180s; if it hangs on "Initializing…" we’ll kill and retry
  $completed = Wait-Job $job -Timeout 180
  if (-not $completed) {
    Write-Warn "db push appears stuck (e.g., 'Initializing…'). Terminating attempt."
    Stop-Job $job -Force | Out-Null
    Remove-Job $job -Force | Out-Null
    return $false
  }

  $result = Receive-Job $job -Keep
  Remove-Job $job -Force | Out-Null

  # Basic success detection
  if ($result -match "Applying migration" -or $result -match "No new migrations to apply" -or $result -match "Finished") {
    Write-Info "db push completed."
    return $true
  } else {
    Write-Warn "db push did not report completion. Check logs."
    return $false
  }
}

# First attempt
$ok = Invoke-PushAttempt 1

# Retry path: refresh link/auth and try again
$attempt = 1
while (-not $ok -and $attempt -le $Retries) {
  $attempt++
  Write-Info "Refreshing auth/link and retrying (attempt $attempt of $(1+$Retries))…"
  try { & supabase logout | Out-Null } catch { }
  try { & supabase login  | Out-Null } catch { }
  try { & supabase link --project-ref $ProjectRef | Out-Null } catch { }
  # Kill potential new locks
  foreach ($p in $procs) { try { Get-Process -Name $p -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue } catch { } }
  Start-Sleep -Seconds 2
  $ok = Invoke-PushAttempt $attempt
}

if (-not $ok) {
  Write-Err "supabase db push did not complete. See log: $logFile"
  Write-Host ""
  Write-Host "Quick tips:" -ForegroundColor Yellow
  Write-Host "  • Ensure VPN/firewall isn't blocking outbound Postgres (Supabase) connections."
  Write-Host "  • Close other SQL editors or DB clients pointing at this project."
  Write-Host "  • Re-run this script; if still stuck, paste $logFile contents to me."
  Pop-Location; exit 2
}

# --- 7) (Optional) Restart OneDrive ------------------------------------------
if (-not $SkipOneDriveStop) {
  Write-Info "Restarting OneDrive…"
  $oneDrivePath = "$Env:LOCALAPPDATA\Microsoft\OneDrive\OneDrive.exe"
  if (Test-Path $oneDrivePath) { Start-Process $oneDrivePath -ErrorAction SilentlyContinue | Out-Null }
}

Write-Info "All done. Migrations are up to date."
Pop-Location
