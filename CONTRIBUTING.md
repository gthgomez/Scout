# Contributing to Scout

## Local verification

```powershell
npm run ci
```

Runs syntax check, unit tests, adversarial eval, policy tests, and ESLint via [`scripts/ci.ps1`](scripts/ci.ps1).

## Branch and PR flow

1. Branch from `main` (e.g. `scout/0.4.1-my-change`)
2. Run `npm run ci` locally
3. Push and open a PR against `main`
4. Wait for **Scout CI** (self-hosted) to pass
5. Squash merge when green

Scout uses a **self-hosted Windows runner** only (no GitHub-hosted minutes). Workflow: [`.github/workflows/ci-selfhosted.yml`](.github/workflows/ci-selfhosted.yml).

## Self-hosted runner requirements

- Windows machine with Node.js **20+** (22 supported)
- GitHub Actions runner registered with labels: `self-hosted`, `windows`
- Runner must reach GitHub and have repo checkout access
- CI runs: `pwsh ./scripts/ci.ps1`

If CI is pending, ensure the local runner service is online.

## Schemas and contracts

Artifact JSON Schemas live under [`schemas/`](schemas/). Runtime validators are in `src/scout/validators.js`. Update schema files and validators together when changing artifact shapes.

## Agent docs

- [`AGENTS.md`](AGENTS.md) — harness routing
- [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) — CLI and artifacts
- [`src/scout/runbooks/README.md`](src/scout/runbooks/README.md) — stage runbooks
