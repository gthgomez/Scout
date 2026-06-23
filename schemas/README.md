# Scout JSON Schemas

Contract files for Scout session artifacts. Runtime validation uses code in `src/scout/validators.js` (no external JSON Schema engine).

| Schema | Artifact | Runtime validator | Validated when |
| --- | --- | --- | --- |
| [handoff-package-1.1.json](./handoff-package-1.1.json) | `handoff_package.json` | `validateHandoffPackage()` | `exportHandoffPackages()` when `discovery_intent` is `beginner` |
| [handoff-package-1.2.json](./handoff-package-1.2.json) | `handoff_package.json` | `validateHandoffPackage()` | `exportHandoffPackages()` when `discovery_intent` is `rewarded` |
| [scout-report-1.0.json](./scout-report-1.0.json) | `scout_report.json` | `validateReportModel()` | `createReportModel()` and report render paths |
| [scout-session-1.0.json](./scout-session-1.0.json) | `scout_session.json` | `validateSessionManifest()` | `saveSessionManifest()` |

## Handoff export options

`exportHandoffPackages(report, { validateOnExport: false })` skips handoff validation (testing only).

## Notes

- Reports do not carry a `schema_version` field; the filename `scout-report-1.0.json` is the contract version.
- Handoff uses `schema_version: "1.1"` for beginner discovery and `schema_version: "1.2"` for rewarded discovery (claim workflow fields on package entries).
- Slack/OpenClaw monitor delivery is not part of these schemas; use the monitoring runbook webhook wrapper pattern.
