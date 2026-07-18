# Income ops — daily monitor + act-top1 + weekly benchmark + scorecard + claims discipline
param(
  [ValidateSet("daily", "weekly", "act", "scorecard")]
  [string]$Mode = "daily",
  [switch]$ExecuteAct,
  [string]$WatchJson = "scout_watch_report.json",
  [string]$WatchMd = "scout_watch_report.md"
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

function Invoke-ScoutWebhook {
  param([string]$JsonBody)
  if (-not $env:SCOUT_WEBHOOK_URL) {
    return
  }
  if (-not $JsonBody) {
    $JsonBody = (@{
        source = "scout-income-ops"
        mode   = $Mode
        at     = (Get-Date).ToUniversalTime().ToString("o")
      } | ConvertTo-Json -Compress)
  }
  try {
    Invoke-RestMethod -Method Post -Uri $env:SCOUT_WEBHOOK_URL -ContentType "application/json" -Body $JsonBody
  } catch {
    Write-Warning "SCOUT_WEBHOOK_URL post failed: $($_.Exception.Message)"
  }
}

function Get-WebhookPayloadFromReport {
  param([string]$ReportPath)
  if (-not (Test-Path $ReportPath)) {
    return $null
  }
  try {
    $payload = & node scripts/webhook-payload.mjs $ReportPath $Mode
    if ($LASTEXITCODE -ne 0) {
      return $null
    }
    return [string]$payload
  } catch {
    Write-Warning "Could not build rich webhook payload: $($_.Exception.Message)"
    return $null
  }
}

if ($Mode -eq "scorecard") {
  Write-Host "==> income scorecard"
  node scripts/income-scorecard.mjs --watch $WatchJson
  exit $LASTEXITCODE
}

if ($Mode -eq "act") {
  Write-Host "==> act-top1 from $WatchJson"
  if ($ExecuteAct) {
    node scripts/act-top1.mjs --report $WatchJson --profile rewarded-cash-in --execute
  } else {
    node scripts/act-top1.mjs --report $WatchJson --profile rewarded-cash-in --dry-run
  }
  exit $LASTEXITCODE
}

if ($Mode -eq "daily") {
  Write-Host "==> scout monitor --profile rewarded-cash-in --skip-known --notify"
  $monitorOut = & node src/scout/cli.js monitor --profile rewarded-cash-in --skip-known --notify --out $WatchMd --json-out $WatchJson 2>&1
  $exitCode = $LASTEXITCODE
  $monitorOut | ForEach-Object { Write-Host $_ }

  $webhookBody = $null
  foreach ($line in $monitorOut) {
    $text = [string]$line
    if ($text -match '^SCOUT_WEBHOOK_JSON\s+(.+)$') {
      $webhookBody = $Matches[1]
    }
  }
  if (-not $webhookBody) {
    $webhookBody = Get-WebhookPayloadFromReport -ReportPath $WatchJson
  }

  if ($exitCode -eq 1) {
    Write-Host "Actionable rewarded-cash-in candidates detected."
    Invoke-ScoutWebhook -JsonBody $webhookBody
    Write-Host "==> act-top1 dry-run (use -Mode act -ExecuteAct to run full workflow)"
    node scripts/act-top1.mjs --report $WatchJson --profile rewarded-cash-in --dry-run
  }
  exit $exitCode
}

Write-Host "==> weekly rewarded-hunt benchmark (nocache)"
node scripts/benchmark-rewarded-hunt.mjs --lane nocache
$benchExit = $LASTEXITCODE
if ($benchExit -ne 0) {
  Write-Warning "Benchmark gate failed — review .scout/benchmark-rewarded-hunt.json"
}
Write-Host "==> seed query audit"
node scripts/audit-seed-queries.mjs
Write-Host "==> income scorecard"
node scripts/income-scorecard.mjs --watch $WatchJson
exit $benchExit
