# tools\nuke-issues.ps1
# Purpose: Permanently remove the "Issues" / "Problem Board" page and all references.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$SrcRoot     = Join-Path $ProjectRoot "src"

$DeletePaths = @(
  "src/pages/Issues.jsx",
  "src/pages/Issues.tsx",
  "src/pages/Issues/index.jsx",
  "src/pages/Issues/index.tsx",
  "src/pages/issues.jsx",
  "src/pages/issues.tsx",
  "src/pages/ProblemBoard.jsx",
  "src/pages/ProblemBoard.tsx",
  "src/pages/problem-board.jsx",
  "src/pages/problem-board.tsx",
  "src/pages/ProblemBoard",
  "src/pages/problem-board",
  "src/pages/Issues",
  "src/components/issues",
  "src/components/Issues",
  "src/components/problem-board",
  "src/components/ProblemBoard",
  "src/features/issues",
  "src/features/problem-board"
)

$CodeGlobs = @("*.js","*.jsx","*.ts","*.tsx")

function Remove-PathSafe {
  param([Parameter(Mandatory)][string]$Target)
  $full = Join-Path $ProjectRoot $Target
  if (Test-Path $full) {
    Write-Host "[DEL] $Target"
    Remove-Item -LiteralPath $full -Recurse -Force
  }
}

function Patch-File {
  param([Parameter(Mandatory)][string]$FilePath)
  $original = Get-Content -Raw -LiteralPath $FilePath
  $patched = $original

  $patched = [regex]::Replace($patched,
    '^[ \t]*import[^\n\r;]*from[ \t]*["'']([^"'']*)(Issues|ProblemBoard|/issues|/problem-board|problemboard)[^"'']*["''];?[ \t]*\r?$\n?',
    '', 'IgnoreCase, Multiline')

  $patched = [regex]::Replace($patched,
    'lazy\s*\(\s*\(\s*?\)\s*=>\s*import\(\s*["''][^"'']*(Issues|ProblemBoard|/issues|/problem-board|problemboard)[^"'']*["'']\s*\)\s*\)',
    '/* removed lazy import */', 'IgnoreCase')

  $patched = [regex]::Replace($patched,
    '<Route\b[^>]*\bpath\s*=\s*["'']/?(issues|problem-board|problemboard)\b[^"'']*["''][^>]*/\s*>',
    '/* removed route */', 'IgnoreCase, Singleline')

  $patched = [regex]::Replace($patched,
    '<Route\b[^>]*\bpath\s*=\s*["'']/?(issues|problem-board|problemboard)\b[^"'']*["''][^>]*>.*?</Route\s*>',
    '/* removed route block */', 'IgnoreCase, Singleline')

  $patched = [regex]::Replace($patched,
    '<(NavLink|Link)\b[^>]*\b(to|href)\s*=\s*["'']/?(issues|problem-board|problemboard)[^"'']*["''][^>]*>.*?</\1\s*>',
    '/* removed nav link */', 'IgnoreCase, Singleline')

  $patched = [regex]::Replace($patched,
    'navigate\s*\(\s*["'']/?(issues|problem-board|problemboard)[^"'']*["'']\s*\)',
    '/* removed navigate */', 'IgnoreCase')

  $patched = [regex]::Replace($patched,
    '\bhref\s*=\s*["'']/?(issues|problem-board|problemboard)[^"'']*["'']',
    '/* removed href */', 'IgnoreCase')

  $patched = [regex]::Replace($patched,
    '\{\s*[^{}]*\b(to|href)\s*:\s*["'']/?(issues|problem-board|problemboard)[^"'']*["''][^{}]*\}\s*,?',
    '/* removed issues nav obj */', 'IgnoreCase, Singleline')

  $patched = [regex]::Replace($patched,
    '["'']/?(issues|problem-board|problemboard)["'']\s*,?',
    '/* removed issues path */', 'IgnoreCase')

  $patched = [regex]::Replace($patched, '(\r?\n){3,}', "`r`n`r`n")
  $patched = $patched -replace ',\s*,', ','

  if ($patched -ne $original) {
    Set-Content -LiteralPath $FilePath -Value $patched -NoNewline
    Write-Host "[EDIT] $FilePath"
    return $true
  } else {
    return $false
  }
}

Write-Host "=== Removing Issues / Problem Board ===`n"

foreach ($p in $DeletePaths) { Remove-PathSafe -Target $p }

$files = Get-ChildItem -LiteralPath $SrcRoot -Recurse -Include $CodeGlobs -File
$patchedCount = 0
foreach ($f in $files) {
  if ($f.FullName -match '\\(dist|build|.vercel)\\') { continue }
  if (Patch-File -FilePath $f.FullName) { $patchedCount++ }
}

Write-Host "`nCompleted."
Write-Host "Files patched: $patchedCount"
Write-Host "You can now run: npm run dev"
