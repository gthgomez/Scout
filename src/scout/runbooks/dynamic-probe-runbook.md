# Dynamic Probe Runbook

## Harness
This runbook is agent-agnostic. Use it from Cursor, Claude Code, Gemini, Antigravity, Codex, or any harness that can invoke the Scout CLI and read local artifacts.

## Purpose
Run approval-bound Docker probes after static inspection evidence exists.

## Allowed probe modes
- `readonly` with `--network none` (Release 2 contract)
- `install_probe` with `--network registry_allowlist`, R2D contract JSON, and exact approval phrase
- `test_probe` only after successful `install_probe` evidence for the same candidate

## Expected Scout CLI backend calls
- `scout probe doctor --json-out scout_probe_doctor.json`
- `scout probe --report <report.json> --candidate-id <id> --approval-id <id> --network none --command-set readonly`
- `scout probe --report <report.json> --candidate-id <id> --approval-id "<R2D phrase>" --network registry_allowlist --command-set install_probe --contract <contract.json>`

## Safety stops
- One candidate per probe command.
- Registry allowlist checks infer hostname from planned argv before execution; commands outside the approved list are blocked pre-execution.
- Docker sandboxes use bridge networking; Scout does not enforce packet-level egress filtering or observe runtime traffic.
- Lifecycle-script risk without an approved lifecycle policy fails closed.
