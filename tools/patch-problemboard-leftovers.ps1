# tools/patch-problemboard-leftovers.ps1
# Purpose: remove leftover ProblemBoard declarations/usages that can break the build.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$SrcRoot     = Join-Path $ProjectRoot "src"
$CodeGlobs   = @("*.js","*.jsx","*.ts","*.tsx")

function Clean-File {
  param([Parameter(Mandatory)][string]$Path)

  # Read as lines to make surgical removals safe.
  $lines   = Get-Content -LiteralPath $Path -ErrorAction Stop

  # 1) Remove any const ProblemBoard = ...; line (including prior "/* removed lazy import */")
  $lines = $lines | Where-Object { $_ -notmatch '^\s*const\s+ProblemBoard\s*=' }

  # 2) Remove any <Route ... ProblemBoard .../> lines (self-closing route lines using ProblemBoard)
  $lines = $lines | Where-Object { $_ -notmatch '<\s*Route\b.*ProblemBoard.*\/\s*>' }

  # 3) Remove any wrapped <Route>...</Route> lines that mention ProblemBoard (common one-line case)
  $lines = $lines | Where-Object { $_ -notmatch '<\s*Route\b.*ProblemBoard.*<\/\s*Route\s*>' }

  # 4) Remove any direct component usage lines like: <ProblemBoard .../> or </ProblemBoard>
  $lines = $lines | Where-Object { $_ -notmatch '<\s*\/?\s*ProblemBoard\b' }

  # 5) Remove simple nav/link config lines referencing ProblemBoard symbol
  $lines = $lines | Where-Object { $_ -notmatch '\bProblemBoard\b' }

  # Write back
  Set-Content -LiteralPath $Path -Value ($lines -join "`r`n")
  Write-Host "[CLEAN] $Path"
}

Write-Host "=== Cleaning leftover ProblemBoard declarations/usages ==="
$files = Get-ChildItem -LiteralPath $SrcRoot -Recurse -Include $CodeGlobs -File
foreach ($f in $files) {
  # Skip build outputs just in case
  if ($f.FullName -match '\\(dist|build|\.vercel)\\') { continue }
  Clean-File -Path $f.FullName
}

Write-Host "Done. Try building again: npm run dev"
