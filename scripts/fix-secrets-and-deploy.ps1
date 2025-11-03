# Fix Supabase Edge Function secrets and redeploy.
$PROJECT_URL  = 'https://tnpesnohwbwpmakvyzpn.supabase.co'
$SERVICE_ROLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRucGVzbm9od2J3cG1ha3Z5enBuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTUxODA4NCwiZXhwIjoyMDc3MDk0MDg0fQ.uucqKGYzYV5_Xjo-amxVVnzwEPf4ZiSBw9WMBO7Jzt8'

if ($SERVICE_ROLE.StartsWith('$')) {
  Write-Warning "SERVICE_ROLE started with '$'. Removing it."
  $SERVICE_ROLE = $SERVICE_ROLE.Substring(1)
}

Write-Host "Setting secrets..." -ForegroundColor Cyan
supabase secrets set PROJECT_URL="$PROJECT_URL"
supabase secrets set SERVICE_ROLE="$SERVICE_ROLE"

Write-Host "`nVerifying secrets exist (digests only)..." -ForegroundColor Cyan
supabase secrets list

Write-Host "`nRedeploying admin-invite-user..." -ForegroundColor Cyan
supabase functions deploy admin-invite-user

Write-Host "`n✅ Done. Now go back to Atlas Command and try sending an invite again." -ForegroundColor Green
