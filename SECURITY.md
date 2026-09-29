# Security Policy

## Scope

`Scout` is a local, policy-gated tool that discovers open-source bounty candidates, fetches their
metadata and archives, and hands work off to external coding agents. It reads from the GitHub API
using a user-supplied token, downloads third-party content, and can drive a Docker sandbox.

In scope:

- **Token and credential handling.** `GITHUB_TOKEN` (or `GH_TOKEN`) and `ALGORA_API_KEY` are read
  from the local environment. Any path that writes them to a report, log, cache file, session
  artifact, or handoff package, or sends them to a host other than the GitHub or Algora API, is in
  scope. Over-scoped token usage that Scout could have done with less is also in scope.
- **Policy enforcement.** `default-policy.yaml` and the sandbox policy govern which operations are
  allowed, denied, or approval-gated. A defect that lets a denied operation proceed without
  `requires_approval`, that bypasses the `--approval-id` gate before probe execution, or that
  weakens the sandbox's `network: none` default, `allow_docker_socket: false`, archive size limits,
  or file-count limits, is in scope.
- **Untrusted content handling.** Repository metadata, issue bodies, README files, and downloaded
  static archives come from third parties. Command injection through those inputs, path traversal
  during archive extraction, or archive extraction outside the session directory is in scope.
- **External agent handoff.** `handoff_package.json` and other artifacts are consumed by other
  tools and agent harnesses. Injected instructions or content that cause an agent to act outside
  the granted policy are in scope; Scout does not enforce policy inside an external harness, so the
  report should describe the artifact that carried the injection.

Out of scope: vulnerabilities in GitHub, Algora, Docker, or Node.js that are reproducible without
this codebase, and the behavior of an external coding agent that ignores its runbook.

## Supported Versions

This project is pre-1.0. The current release is documented in `README.md`.

| Version | Supported |
| --- | --- |
| `main` (latest commit) | Yes |
| Latest tagged release | Yes |
| Any earlier commit, branch, or release | No |

Only the current tip of `main` and the most recent release receive security fixes.

## Reporting a Vulnerability

Use GitHub's private vulnerability reporting: go to the repository's **Security** tab and click
**Report a vulnerability**. This opens a private advisory visible only to the maintainer.

If private reporting is unavailable to your account, open a
[security advisory](https://github.com/gthgomez/Scout/security/advisories/new) directly. There is
no published email address for this project, so the advisory channel is the supported route.

Please do not open a public issue for an unfixed defect, and never include a real personal access
token or Algora key in a report. Redact them.

## What to Include

- Type of defect, mapped to the categories above: credential exposure, policy or approval-gate
  bypass, sandbox weakening, untrusted-content handling, or handoff-artifact injection.
- Affected commit SHA or release tag, Node.js version, and the workflow preset and discovery
  profile you ran.
- The command line that reproduces it and the resulting artifact or log excerpt, with credentials
  redacted.
- The expected policy outcome (allowed, denied, or approval-required) versus the observed one.
- For archive findings, the repository you fetched and whether the payload was public.

## Maintainer Response

The maintainer commits to the following:

- Acknowledge a report within 7 days.
- Provide a severity assessment and a remediation or mitigation plan within 30 days of
  acknowledgement.
- Credit reporters in the advisory and release notes unless anonymity is requested.

For a report that indicates a leaked token or key, the maintainer will treat revocation as the
first step and will say so in the acknowledgement.

## Coordinated Disclosure

Fixes land before public disclosure. A reporter should allow up to 90 days from first contact for
a fix or a documented mitigation before publishing, and the maintainer will not cut that period
short without agreeing with the reporter. Credential exposure is treated as urgent and is
prioritized ahead of the 90-day window.

## No Bug Bounty

There is no bug bounty program for this project, and no payment is offered for reports. Credit and
a public advisory are the entire compensation.
