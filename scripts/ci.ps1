# Scout local CI — run this instead of GitHub Actions (no cloud runners).
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host "==> npm ci (fail closed; no npm-install fallback)"
npm ci --ignore-scripts
if ($LASTEXITCODE -ne 0) {
  Write-Error "npm ci failed (exit $LASTEXITCODE). Do not fall back to npm install; fix the lockfile instead."
  exit $LASTEXITCODE
}

Write-Host "==> syntax check"
node scripts/check-syntax.js
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> npm test"
npm test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> npm run test:adversarial"
npm run test:adversarial
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> npm run test:policy"
npm run test:policy
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> npm run lint"
npm run lint
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Scout local CI passed."
