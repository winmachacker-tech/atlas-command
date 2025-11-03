# tools/set-secrets-and-deploy.ps1
# - Bypasses root .env parsing by using a temp env file
# - Uses neutral names: SERVICE_ROLE_KEY and SB_URL
# - Deploys function and re-checks CORS

$ErrorActionPreference = 'Stop'
$ProjectRoot = 'C:\Users\mtish\OneDrive\Desktop\atlas-command'
$projectRef  = 'tnpesnohwbwpmakvyzpn'
Set-Location $ProjectRoot

# 0) Optional: temporarily move BOM-tainted .env out of the way during CLI ops
$rootEnv = Join-Path $ProjectRoot '.env'
$rootEnvBak = Join-Path $ProjectRoot '.env.frontend.bak'
if (Test-Path $rootEnv) {
  Rename-Item $rootEnv $rootEnvBak -Force
}

# 1) Gather inputs
$frontendUrl = Read-Host -Prompt 'Enter FRONTEND_URL (Enter for default https://atlas-command-iota.vercel.app)'
if ([string]::IsNullOrWhiteSpace($frontendUrl)) { $frontendUrl = 'https://atlas-command-iota.vercel.app' }

# Service key (paste; input hidden)
$s = Read-Host -AsSecureString -Prompt 'Paste SERVICE_ROLE_KEY (input hidden)'
$b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
$serviceRoleKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)
if ([string]::IsNullOrWhiteSpace($serviceRoleKey)) { Write-Error 'SERVICE_ROLE_KEY required.'; exit 1 }

$useResend = Read-Host -Prompt 'Configure Resend now? type y to proceed, anything else to skip'
$resendKey = ''
$resendFrom = ''
if ($useResend -eq 'y') {
  $rs = Read-Host -AsSecureString -Prompt 'Paste RESEND_API_KEY (hidden) or Enter to skip'
  $rb = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($rs)
  $resendKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($rb)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($rb)
  $resendFrom = Read-Host -Prompt 'Enter RESEND_FROM sender (e.g. Atlas Command no-reply@yourdomain.com)'
}

# 2) Create a temp env file for secrets
$tmpEnv = Join-Path $env:TEMP "supabase_secrets_$([guid]::NewGuid().ToString('N')).env"
@(
  "SERVICE_ROLE_KEY=$serviceRoleKey"
  "SB_URL=https://$projectRef.supabase.co"
  "FRONTEND_URL=$frontendUrl"
  $(if ($resendKey)  { "RESEND_API_KEY=$resendKey" })
  $(if ($resendFrom) { "RESEND_FROM=$resendFrom" })
) | Set-Content -Encoding ascii $tmpEnv

# 3) Link (if needed) and set secrets from the temp env file
try { supabase link | Out-Null } catch { }
supabase secrets set --env-file $tmpEnv

# 4) Deploy
supabase functions deploy admin-invite-user

# 5) CORS probe
$fnUrl = "https://$projectRef.supabase.co/functions/v1/admin-invite-user"
try {
  $resp = Invoke-WebRequest -Method Options -Uri $fnUrl -ErrorAction Stop
  "STATUS: $($resp.StatusCode)"
  "ACAO:   $($resp.Headers['Access-Control-Allow-Origin'])"
  "ACAM:   $($resp.Headers['Access-Control-Allow-Methods'])"
  "ACAH:   $($resp.Headers['Access-Control-Allow-Headers'])"
} catch {
  Write-Warning "OPTIONS failed. Ensure your function returns CORS headers on all paths."
  Write-Warning $_.Exception.Message
}

# 6) Cleanup temp file; restore .env
Remove-Item $tmpEnv -Force -ErrorAction SilentlyContinue
if (Test-Path $rootEnvBak) { Rename-Item $rootEnvBak $rootEnv -Force }

"Done. Test Invite in the app."
