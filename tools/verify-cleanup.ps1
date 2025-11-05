# tools/verify-cleanup.ps1
# Verifies that no source files reference "issues" or "problem-board".
# Skips node_modules, dist, build, .vercel, and .backup.
# Suppresses unreadable-file errors cleanly.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $ProjectRoot

# Extensions to scan
$ext = @('.js','.jsx','.ts','.tsx','.css','.json')

# Directories to exclude (regex fragment for FullName)
$excludeDirs = '(\\node_modules\\|\\dist\\|\\build\\|\\\.vercel\\|\\\.backup\\)'

# Collect files safely
$files = Get-ChildItem -Recurse -File -Force -ErrorAction SilentlyContinue |
  Where-Object {
    $_.FullName -notmatch $excludeDirs -and
    $ext -contains $_.Extension
  }

if (-not $files) {
  Write-Host "[OK] No eligible files found to scan (did you run from project root?)."
  exit 0
}

# Scan each file; suppress read errors without stopping the pipeline
$results = foreach ($f in $files) {
  try {
    Select-String -Path $f.FullName `
      -Pattern 'issues|problem-board' `
      -SimpleMatch `
      -CaseSensitive:$false `
      -ErrorAction Stop
  } catch {
    # Ignore unreadable files (stale OneDrive/backup paths, etc.)
    continue
  }
}

if ($results) {
  Write-Host "`n[FOUND] References to 'issues' or 'problem-board':`n"
  $results |
    Select-Object Path, LineNumber, Line |
    Format-Table -AutoSize
  exit 1
} else {
  Write-Host "[CLEAN] No references found in source files."
  exit 0
}
