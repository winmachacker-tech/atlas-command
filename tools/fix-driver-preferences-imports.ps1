# tools/fix-driver-preferences-imports.ps1
# Purpose: create shim and fix wrong imports without fragile regex.

$ErrorActionPreference = "Stop"

function Write-File($Path, $Content) {
  $dir = Split-Path -Parent $Path
  if (!(Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  Set-Content -Path $Path -Value $Content -Encoding UTF8
}

# 1) Ensure shim: src/lib/driverPreferences.js
$shimPath = "src/lib/driverPreferences.js"
$shimContent = @'
// src/lib/driverPreferences.js
// Compatibility shim for older imports.
// Re-exports everything from driverPreferences.jsx and adds getDriverPreferenceCard().

import * as api from "./driverPreferences.jsx";
export * from "./driverPreferences.jsx";
export default api;

/** Back-compat: returns a small "card" built from v_driver_fit */
export async function getDriverPreferenceCard(driverId) {
  if (!api || typeof api.getDriverFitForDriver !== "function") {
    throw new Error("driverPreferences: getDriverFitForDriver() not available from .jsx");
  }
  const fit = await api.getDriverFitForDriver(driverId);
  return {
    driver_id: fit?.driver_id ?? driverId,
    title: "Driver Fit",
    fit_score: typeof fit?.fit_score === "number" ? fit.fit_score : 0,
    up_events: fit?.up_events ?? 0,
    down_events: fit?.down_events ?? 0,
    last_feedback_at: fit?.last_feedback_at ?? null,
  };
}
'@
Write-File $shimPath $shimContent
Write-Host "Wrote shim: $shimPath"

# 2) Fix imports across src
$srcRoot = "src"
$files = Get-ChildItem -Path $srcRoot -Recurse -Include *.js,*.jsx,*.ts,*.tsx | Where-Object {
  -not $_.FullName.EndsWith("driverPreferences.js")
}

function IsImportLine($line) {
  return ($line -like "import*from*") -or ($line -like "import * from*")
}
function IsDefaultImport($line) {
  # default import: "import X from ..." and no '{'
  return ($line -match '^\s*import\s+[A-Za-z0-9_\$]+\s+from\s+') -and (-not $line.Contains("{"))
}
function IsNamedImport($line) {
  return $line.Contains("{")
}

$changed = 0

foreach ($f in $files) {
  $content = Get-Content -Raw -Path $f.FullName
  $orig = $content

  # split by newline safely
  $lines = $content -split "`r?`n"

  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]

    if (-not (IsImportLine $line)) { continue }

    $hasComponentsPath = $line.Contains("components/DriverPreferences.jsx")
    $hasLibJsxPath     = $line.Contains("lib/driverPreferences.jsx")
    $hasLibJsPath      = $line.Contains("lib/driverPreferences.js")
    $hasLibAnyPath     = $hasLibJsxPath -or $hasLibJsPath

    # A) If named import from components (functions pulled from component) -> to lib shim
    if ($hasComponentsPath -and (IsNamedImport $line)) {
      $lines[$i] = $line.Replace("components/DriverPreferences.jsx","lib/driverPreferences.js")
      continue
    }

    # B) If default import from lib (component wrongly imported from lib) -> to component
    if ($hasLibAnyPath -and (IsDefaultImport $line)) {
      $lines[$i] = $lines[$i].Replace("lib/driverPreferences.jsx","components/DriverPreferences.jsx")
      $lines[$i] = $lines[$i].Replace("lib/driverPreferences.js","components/DriverPreferences.jsx")
      continue
    }

    # C) Normalize any remaining lib .jsx -> .js (functions should use shim path)
    if ($hasLibJsxPath) {
      $lines[$i] = $line.Replace("lib/driverPreferences.jsx","lib/driverPreferences.js")
      continue
    }
  }

  $newContent = [string]::Join("`n", $lines)
  if ($newContent -ne $orig) {
    Set-Content -Path $f.FullName -Value $newContent -Encoding UTF8
    Write-Host "Fixed imports in $($f.FullName)"
    $changed++
  }
}

Write-Host ""
Write-Host "Summary:"
Write-Host "  Files updated : $changed"
Write-Host "  Shim ensured  : $shimPath"
Write-Host "Done. Restart dev server: npm run dev"
