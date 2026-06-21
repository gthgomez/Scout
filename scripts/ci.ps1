# Scout local CI — run this instead of GitHub Actions (no cloud runners).
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host "==> npm ci"
npm ci --ignore-scripts 2>$null
if ($LASTEXITCODE -ne 0) { npm install }

Write-Host "==> syntax check"
node scripts/check-syntax.js
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> npm test"
npm test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> npm run test:adversarial"
npm run test:adversarial
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> npm run lint"
npm run lint
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Scout local CI passed."
