# Benchmark Scout discovery modes (local mock-friendly).
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host "==> Scout discovery benchmark (REST serial baseline via --enrich-mode rest)"
$env:SCOUT_ENRICH_MODE = "rest"
$env:SCOUT_GITHUB_CONCURRENCY = "1"
$sw = [System.Diagnostics.Stopwatch]::StartNew()
node src/scout/cli.js discover --limit 5 --enrich-mode rest --no-cache --out .scout/bench_rest.md --json-out .scout/bench_rest.json 2>$null
$sw.Stop()
Write-Host "REST mode elapsed: $($sw.ElapsedMilliseconds)ms"

Write-Host "==> Scout discovery benchmark (auto: cache + concurrency + graphql when token present)"
Remove-Item Env:SCOUT_ENRICH_MODE -ErrorAction SilentlyContinue
Remove-Item Env:SCOUT_GITHUB_CONCURRENCY -ErrorAction SilentlyContinue
$sw2 = [System.Diagnostics.Stopwatch]::StartNew()
node src/scout/cli.js discover --limit 5 --enrich-mode auto --out .scout/bench_auto.md --json-out .scout/bench_auto.json 2>$null
$sw2.Stop()
Write-Host "Auto mode elapsed: $($sw2.ElapsedMilliseconds)ms"
Write-Host "Benchmark complete. Compare durations and GitHub API call counts in audit logs."
