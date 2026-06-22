# Run Scout monitor locally (example for Windows Task Scheduler).
# Schedule: daily at 09:00 — schtasks /Create /TN "ScoutMonitor" /TR "pwsh -File C:\path\to\Scout\scripts\monitor.ps1" /SC DAILY /ST 09:00
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$Profile = if ($env:SCOUT_MONITOR_PROFILE) { $env:SCOUT_MONITOR_PROFILE } else { "beginner-python-ts" }

Write-Host "==> scout monitor --profile $Profile --skip-known --notify"
node src/scout/cli.js monitor --profile $Profile --skip-known --notify --out scout_watch_report.md --json-out scout_watch_report.json
$exitCode = $LASTEXITCODE
if ($exitCode -eq 1) {
  Write-Host "Scout monitor detected new or improved candidates."
}
exit $exitCode
