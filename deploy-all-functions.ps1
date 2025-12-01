# FILE: deploy-all-functions.ps1
# Purpose:
# - Deploy every Supabase Edge Function found under supabase/functions.
# - Only deploys functions that exist locally.
# - Safe: Does not modify RLS or database security.

Write-Host "=== Atlas Command: Deploying all Supabase functions ===`n"

# Path to functions folder
$functionsPath = "supabase/functions"

if (-not (Test-Path $functionsPath)) {
    Write-Error "ERROR: Functions path '$functionsPath' does not exist. Are you in the project root?"
    exit 1
}

# List all directories (each directory = one function)
$functionFolders = Get-ChildItem $functionsPath -Directory | Select-Object -ExpandProperty Name

if ($functionFolders.Count -eq 0) {
    Write-Host "No functions found in '$functionsPath'. Nothing to deploy."
    exit 0
}

Write-Host "Found functions:"
foreach ($fn in $functionFolders) {
    Write-Host " - $fn"
}

Write-Host "`nStarting deployments...`n"

foreach ($fn in $functionFolders) {
    Write-Host "Deploying function: $fn ..."
    supabase functions deploy $fn

    if ($LASTEXITCODE -ne 0) {
        Write-Warning "WARNING: Failed to deploy function '$fn'."
    } else {
        Write-Host "Success: '$fn' deployed."
    }

    Write-Host ""
}

Write-Host "=== Deployment complete. Check Supabase Dashboard > Functions. ==="
