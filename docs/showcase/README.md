# Offline Scout showcase

This is a reproducible local demo of Scout 0.6.2, captured on 2026-10-30 from source commit `23ef8343594cb6f892a3d569f1aa65e6f96f5c24` plus the showcase script in this directory. It uses the repository's synthetic `report-model.json` unit-test fixture. `acme/tooling` and its issue are example data, not a real lead or a verified bounty.

- [Video: paced terminal-output playback](offline-demo.mp4)
- [Animated preview](offline-demo.gif)
- [Recorded stdout](transcript.txt)
- [Discovery screenshot](discovery.png) and [handoff screenshot](handoff.png)
- [Browser transcript viewer](transcript.html) (download and open locally)

## Reproduce

From the repository root:

```sh
node docs/showcase/run-offline.mjs
```

No dependencies or credentials are needed for this example. Use the project's supported Node.js range (`>=22.12.0 <25`); this capture used Node.js 24.19.0. The primary CI runtime remains pinned in `.nvmrc`.

The script calls the real discovery mapper with an injected local GitHub-shaped search response and `enrich: false`. It then independently reviews the existing unit-test report, whose GREEN decision and evidence were seeded by the fixture; it does not present that decision as a new live triage result. The two examples intentionally have different candidate IDs. Real CLI subprocesses validate that report and export the cockpit and schema 1.1 handoff. Assertions check successful exits, metadata-only mode, and denied GitHub writes. Output artifacts are written to a new temporary directory printed at the end.

The script blocks accidental use of global `fetch` in discovery. The demonstrated review/export CLI commands only read and write local files. No archive downloads, package installs, probes, live research, issue claims, contacts, provider calls, or GitHub writes occur in the demo. No paid provider is needed. This example exercises the beginner handoff schema; rewarded handoffs additionally use schema 1.2 and require separate verification of reward terms.

## Capture provenance

The PNGs are browser screenshots of the actual stdout in `transcript.txt`, displayed in a terminal-style viewer. The MP4 records that viewer cycling through discovery, review/export, and handoff sections for readability; the GIF is derived from the same video. These are paced transcript playback, not a recording of a native graphical UI or real-time typing. Temporary paths are normalized to `<output>` by the runner, and the final temporary-directory path is normalized in the published transcript. No output fields or results are invented.

To refresh the media, run the example, replace the viewer's text sections with its stdout, then record the local `transcript.html` viewer and capture its discovery and handoff states. Keep the fixture badge and provenance visible. The browser viewer loads no external resources.

The code fixture, demo script, and captures follow this repository's [MIT license](../../LICENSE). The showcase does not establish accepted work, earnings, verified payouts, or production readiness. Follow the [agent handoff contract](../agent/AGENT_HANDOFF.md) before acting on a real session.
