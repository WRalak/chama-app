# One-time local setup against a Supabase Postgres database (Windows PowerShell).
#
#   cd C:\path\to\chama-app
#   powershell -ExecutionPolicy Bypass -File scripts\setup-supabase.ps1
#
# It asks for the Supabase "Session pooler" connection string (Connect button in the
# Supabase dashboard, port 5432), writes the .env files, installs dependencies,
# creates the ChamaHub tables in Supabase and loads the clearly-marked demo data.
# The connection string is written only to backend\.env, which git ignores.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host ''
Write-Host 'ChamaHub setup with Supabase' -ForegroundColor Green
Write-Host 'Paste the Session pooler connection string from Supabase (Connect > Session pooler),'
Write-Host 'with [YOUR-PASSWORD] replaced by your database password.'
$secure = Read-Host 'Connection string' -AsSecureString
$url = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)).Trim()

if ($url -notmatch '^postgres(ql)?://') { throw 'That does not look like a postgresql:// connection string.' }
if ($url -match '\[YOUR-PASSWORD\]') { throw 'Replace [YOUR-PASSWORD] with your database password first.' }
if ($url -match ':6543/') { throw 'That is the transaction pooler (port 6543). Use the Session pooler string (port 5432).' }

function New-Secret {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

# backend\.env: start from the example, set the database and fresh secrets.
$envText = Get-Content 'backend\.env.example' -Raw
$envText = $envText -replace '(?m)^DATABASE_URL=.*$', ('DATABASE_URL=' + $url.Replace('$', '$$'))
$envText = $envText -replace '(?m)^JWT_ACCESS_SECRET=.*$', ('JWT_ACCESS_SECRET=' + (New-Secret))
$envText = $envText -replace '(?m)^OTP_SECRET=.*$', ('OTP_SECRET=' + (New-Secret))
Set-Content -Path 'backend\.env' -Value $envText -NoNewline -Encoding utf8
Write-Host 'Wrote backend\.env' -ForegroundColor Green

if (-not (Test-Path 'web\.env.local')) { Copy-Item 'web\.env.example' 'web\.env.local'; Write-Host 'Wrote web\.env.local' }
if (-not (Test-Path 'mobile\.env')) { Copy-Item 'mobile\.env.example' 'mobile\.env'; Write-Host 'Wrote mobile\.env' }

Write-Host 'Installing dependencies (a few minutes the first time)...' -ForegroundColor Green
npm install
if ($LASTEXITCODE -ne 0) { throw 'npm install failed. Check your internet connection and run the script again.' }

Write-Host 'Creating the ChamaHub tables in Supabase and loading demo data...' -ForegroundColor Green
npm run dev:setup
if ($LASTEXITCODE -ne 0) { throw 'Database setup failed. Check the connection string and password, then run the script again.' }

Write-Host ''
Write-Host 'Done. Start the apps, each in its own window:' -ForegroundColor Green
Write-Host '  npm run dev:api      (backend, http://localhost:4000)'
Write-Host '  npm run dev:admin    (dashboard, http://localhost:3000)'
Write-Host '  npm run dev:mobile   (phone app)'
Write-Host 'Sign in with 0700 000 001 / Demo1234 (demo data only).'
