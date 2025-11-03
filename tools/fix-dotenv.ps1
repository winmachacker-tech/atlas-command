# tools/fix-dotenv.ps1
# Cleans the root .env so Supabase CLI stops erroring.

$ErrorActionPreference = 'Stop'
$projectRoot = 'C:\Users\mtish\OneDrive\Desktop\atlas-command'
Set-Location $projectRoot

$dotenv = Join-Path $projectRoot '.env'
if (-not (Test-Path $dotenv)) {
  Write-Host 'No .env file found. Nothing to fix.'
  Read-Host 'Press Enter to close'
  exit 0
}

# 1) Backup
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = ".\.env.backup.$ts"
Copy-Item $dotenv $backup -Force
Write-Host "Backed up .env -> $backup"

# 2) Read, remove BOM and bad chars
[byte[]]$bytes = [System.IO.File]::ReadAllBytes($dotenv)
$first = ($bytes | Select-Object -First 3) -join ','
Write-Host "First 3 bytes: $first (239,187,191 = UTF-8 BOM)"
$raw = Get-Content -Raw $dotenv
if ($raw.StartsWith([char]0xFEFF)) {
  $raw = $raw.Substring(1)
  Write-Host 'Removed UTF-8 BOM.'
}
$clean = $raw -replace '[\u00AB\u00BB]', '' -replace '[^\u0009\u000A\u000D\u0020-\u007E]', ''
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($dotenv, $clean, $utf8NoBom)
Write-Host 'Rewrote .env in UTF-8 without BOM.'

# 3) Quick validation
$lines = $clean -split "`n"
$bad = $lines | Where-Object {$_ -and ($_ -notmatch '^[A-Z0-9_]+=.*$') -and (-not $_.StartsWith('#'))}
if ($bad) {
  Write-Warning "Found lines that are not KEY=VALUE:`n$bad"
} else {
  Write-Host 'All lines look OK.'
}

# 4) Redeploy to confirm
try {
  Write-Host 'Redeploying Edge Function admin-invite-user...'
  supabase functions deploy admin-invite-user
  Write-Host 'Redeploy OK.'
} catch {
  Write-Warning 'Deploy failed (CLI may still see issues).'
}

Read-Host 'Press Enter to close'
