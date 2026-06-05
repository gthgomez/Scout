import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { assertAllowed, defaultPolicy } from "./policy.js";
import { setupIntelligenceFromCandidate } from "./setup-intelligence.js";
import {
  buildGitHubArchiveUrl,
  extractSafeZipEntries,
  fetchCandidateArchiveBuffer,
  parseZipArchiveEntries,
  validateArchiveManifestEntries,
} from "./static-inspection.js";
import { validateProbePlan, validateSandboxPolicy, validateSandboxRun } from "./validators.js";

const MAX_DURATION_SECONDS = 120;
const DEFAULT_DURATION_SECONDS = 60;

export const DEFAULT_SANDBOX_POLICY = Object.freeze({
  image: "node:20-alpine",
  network: "none",
  timeout_seconds: DEFAULT_DURATION_SECONDS,
  cpu_count: 1,
  memory_mb: 512,
  pids_limit: 128,
  disk_mb: 256,
  allow_host_home: false,
  allow_ssh_agent: false,
  allow_credential_helper: false,
  allow_docker_socket: false,
  inherit_host_env: false,
  mounts: [],
});

export const SUPPORTED_NETWORK_POLICIES = Object.freeze(["none"]);
export const SUPPORTED_COMMAND_SETS = Object.freeze(["readonly"]);

export function createSandboxPolicy(options = {}) {
  const timeout = Number(options.max_duration_seconds ?? options.timeout_seconds ?? DEFAULT_DURATION_SECONDS);
  const policy = {
    ...DEFAULT_SANDBOX_POLICY,
    ...options,
    network: options.network ?? DEFAULT_SANDBOX_POLICY.network,
    timeout_seconds: Math.min(Math.max(Number.isInteger(timeout) && timeout > 0 ? timeout : DEFAULT_DURATION_SECONDS, 1), MAX_DURATION_SECONDS),
    mounts: [],
  };
  delete policy.max_duration_seconds;
  return validateSandboxPolicy(policy);
}

export function createProbePlan({
  report,
  candidateId,
  approvalId,
  network = "none",
  commandSet = "readonly",
  maxDurationSeconds = DEFAULT_DURATION_SECONDS,
  sandboxPolicy = undefined,
}) {
  if (!approvalId || typeof approvalId !== "string") {
    throw new Error("probe requires --approval-id before sandbox planning.");
  }
  if (!SUPPORTED_NETWORK_POLICIES.includes(network)) {
    throw new Error(`Unsupported probe network policy: ${network}. Release 2 initially supports only network none.`);
  }
  if (!SUPPORTED_COMMAND_SETS.includes(commandSet)) {
    throw new Error(`Unsupported probe command set: ${commandSet}. Release 2 initially supports only readonly.`);
  }
  const candidate = report?.candidates?.find((item) => item.candidate_id === candidateId);
  if (!candidate) {
    throw new Error(`Unknown candidate id: ${candidateId}`);
  }
  if (!hasStaticInspectionEvidence(candidate, report?.evidence ?? [])) {
    throw new Error(`Candidate ${candidateId} must have static inspection evidence before dynamic probing.`);
  }

  const commands = readonlyCommandsForCandidate(candidate);
  const deniedCommands = deniedCommandsFromStaticObservations(candidate);
  const setupIntelligence = setupIntelligenceFromCandidate(candidate);
  const policy = createSandboxPolicy({
    ...(sandboxPolicy ?? {}),
    network,
    timeout_seconds: maxDurationSeconds,
  });
  return validateProbePlan({
    plan_id: `probe-plan-${candidateId}-${Date.now()}`,
    candidate_id: candidateId,
    approval_id: approvalId,
    command_set: commandSet,
    network_policy: network,
    sandbox_policy: policy,
    source_refs: [
      {
        type: "github_archive",
        ref: buildGitHubArchiveUrl(candidate),
      },
    ],
    commands,
    denied_commands: deniedCommands,
    next_evidence_action: setupIntelligence.recommended_next_evidence_action,
    created_at: new Date().toISOString(),
  });
}

export async function runProbe({
  report,
  candidateId,
  approvalId,
  runner = new DockerSandboxRunner(),
  fetchImpl = globalThis.fetch,
  outputDir = null,
  network = "none",
  commandSet = "readonly",
  maxDurationSeconds = DEFAULT_DURATION_SECONDS,
  policy = defaultPolicy("dynamic_probe"),
  sourceDir = null,
}) {
  const plan = createProbePlan({
    report,
    candidateId,
    approvalId,
    network,
    commandSet,
    maxDurationSeconds,
  });
  assertSandboxLifecycleAllowed(policy, approvalId);

  const artifactsDir = resolve(outputDir ?? join(".scout", "probe", sanitizeId(`${candidateId}-${Date.now()}`)));
  await mkdir(artifactsDir, { recursive: true });

  let stagedSourceDir = sourceDir;
  let cleanupStagedSource = false;
  if (!stagedSourceDir) {
    const staged = await stageCandidateSource({ report, candidateId, policy, fetchImpl });
    stagedSourceDir = staged.sourceDir;
    cleanupStagedSource = true;
  }

  const sandboxRuns = [];
  const commandAttempts = [];
  let sandbox = null;
  let cleanupStatus = "not_started";
  try {
    sandbox = await runner.createSandbox(plan.sandbox_policy);
    sandboxRuns.push(createSandboxRun({ sandbox, plan, status: "created", cleanupStatus: "pending" }));

    await runner.stageSource({ sandbox, sourceDir: stagedSourceDir });
    for (const command of plan.commands) {
      const startedAt = new Date().toISOString();
      const result = await runner.runCommand({
        sandbox,
        command,
        artifactsDir,
        approvalId,
        timeoutSeconds: plan.sandbox_policy.timeout_seconds,
      });
      commandAttempts.push(commandAttemptFromResult({
        candidateId,
        command,
        approvalId,
        sandbox,
        startedAt,
        result,
      }));
    }
  } finally {
    if (sandbox) {
      try {
        const destroyed = await runner.destroySandbox(sandbox);
        cleanupStatus = destroyed?.cleanup_status ?? "removed";
      } catch (error) {
        cleanupStatus = `failed: ${error.message}`;
      }
      sandboxRuns.push(
        createSandboxRun({
          sandbox,
          plan,
          status: "destroyed",
          cleanupStatus,
          destroyedAt: new Date().toISOString(),
        }),
      );
    }
    if (cleanupStagedSource) {
      await rm(stagedSourceDir, { recursive: true, force: true });
    }
  }

  const evidence = commandAttempts.map((attempt) => ({
    evidence_id: `evidence-probe-${attempt.command_id}`,
    candidate_id: attempt.candidate_id,
    source_type: "SANDBOX_COMMAND",
    source_ref: attempt.stdout_artifact ?? "sandbox command",
    observed_at: attempt.observed_at,
    trust_level: attempt.status === "passed" ? "OBSERVED" : "UNKNOWN",
    claim: `Readonly probe command ${formatArgv(attempt.command)} ${attempt.status}.`,
    supports: "dynamic probe evidence",
  }));

  const probeStatus = commandAttempts.length === 0
    ? "blocked"
    : commandAttempts.every((attempt) => attempt.status === "passed")
      ? "complete"
      : "partial";

  return {
    ...report,
    generated_at: new Date().toISOString(),
    runtime_safety_status:
      "Release 2: Docker-backed dynamic probing is probe-only, no-network, readonly, approval-bound, and still denies installs, repo scripts, GitHub writes, and coding workflows.",
    evidence: [...(report.evidence ?? []), ...evidence],
    command_attempts: [...(report.command_attempts ?? []), ...commandAttempts],
    sandbox_runs: [...(report.sandbox_runs ?? []), ...sandboxRuns.map(validateSandboxRun)],
    probe_config: {
      approval_id: approvalId,
      candidate_id: candidateId,
      command_set: commandSet,
      network_policy: network,
      sandbox_policy: plan.sandbox_policy,
      denied_commands: plan.denied_commands,
      next_evidence_action: plan.next_evidence_action,
    },
    probe_status: probeStatus,
  };
}

export class FakeSandboxRunner {
  constructor(results = []) {
    this.results = results;
    this.commands = [];
    this.destroyed = false;
  }

  async createSandbox(policy) {
    return {
      sandbox_id: `fake-sandbox-${Date.now()}`,
      image: policy.image,
      created_at: new Date().toISOString(),
      policy,
    };
  }

  async stageSource({ sandbox, sourceDir }) {
    sandbox.source_dir = sourceDir;
    return { staged: true, source_dir: sourceDir };
  }

  async runCommand({ sandbox, command, artifactsDir }) {
    this.commands.push(command);
    const index = this.commands.length - 1;
    const configured = this.results[index] ?? { exit_code: 0, stdout: "ok\n", stderr: "", result: "passed" };
    const commandId = `cmd-${sanitizeId(command.join("-"))}-${index}`;
    const stdoutArtifact = join(artifactsDir, `${commandId}.stdout.txt`);
    const stderrArtifact = join(artifactsDir, `${commandId}.stderr.txt`);
    await writeFile(stdoutArtifact, configured.stdout ?? "", "utf8");
    await writeFile(stderrArtifact, configured.stderr ?? "", "utf8");
    return {
      command_id: commandId,
      sandbox_id: sandbox.sandbox_id,
      exit_code: configured.exit_code ?? 0,
      stdout_artifact: stdoutArtifact,
      stderr_artifact: stderrArtifact,
      duration_ms: configured.duration_ms ?? 1,
      result: configured.result ?? ((configured.exit_code ?? 0) === 0 ? "passed" : "failed"),
      reason: configured.reason ?? "Readonly command completed in fake sandbox.",
    };
  }

  async destroySandbox() {
    this.destroyed = true;
    return { cleanup_status: "removed" };
  }
}

export class DockerSandboxRunner {
  async createSandbox(policy) {
    validateDockerPolicy(policy);
    return {
      sandbox_id: `docker-run-${Date.now()}`,
      image: policy.image,
      created_at: new Date().toISOString(),
      policy,
    };
  }

  async stageSource({ sandbox, sourceDir }) {
    sandbox.source_dir = sourceDir;
    return { staged: true, source_dir: sourceDir };
  }

  async runCommand({ sandbox, command, artifactsDir, timeoutSeconds }) {
    validateDockerPolicy(sandbox.policy);
    const commandId = `cmd-${sanitizeId(command.join("-"))}-${Date.now()}`;
    const stdoutArtifact = join(artifactsDir, `${commandId}.stdout.txt`);
    const stderrArtifact = join(artifactsDir, `${commandId}.stderr.txt`);
    const started = Date.now();
    const result = await runDockerCommand({
      policy: sandbox.policy,
      sourceDir: sandbox.source_dir,
      command,
      stdoutArtifact,
      stderrArtifact,
      timeoutSeconds,
    });
    return {
      command_id: commandId,
      sandbox_id: sandbox.sandbox_id,
      exit_code: result.exit_code,
      stdout_artifact: stdoutArtifact,
      stderr_artifact: stderrArtifact,
      duration_ms: Date.now() - started,
      result: result.exit_code === 0 ? "passed" : result.timed_out ? "timeout" : "failed",
      reason: result.timed_out ? "Readonly command timed out." : "Readonly command completed in Docker sandbox.",
    };
  }

  async destroySandbox() {
    return { cleanup_status: "removed" };
  }
}

export function validateDockerPolicy(policy) {
  validateSandboxPolicy(policy);
  const failures = [];
  if (policy.network !== "none") failures.push("network must be none");
  if (policy.allow_host_home !== false) failures.push("host home mounts are blocked");
  if (policy.allow_ssh_agent !== false) failures.push("SSH agent forwarding is blocked");
  if (policy.allow_credential_helper !== false) failures.push("credential helpers are blocked");
  if (policy.allow_docker_socket !== false) failures.push("Docker socket mounts are blocked");
  if (policy.inherit_host_env !== false) failures.push("host environment inheritance is blocked");
  if (Array.isArray(policy.mounts) && policy.mounts.length > 0) failures.push("custom host mounts are blocked");
  if (failures.length > 0) {
    throw new Error(`Docker sandbox policy is unsafe: ${failures.join("; ")}.`);
  }
  return policy;
}

export function buildDockerRunArgs({ policy, sourceDir, command }) {
  return [
    "run",
    "--rm",
    "--pull",
    "never",
    "--network",
    "none",
    "--cpus",
    String(policy.cpu_count),
    "--memory",
    `${policy.memory_mb}m`,
    "--pids-limit",
    String(policy.pids_limit),
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
    "--env",
    "HOME=/tmp",
    "--workdir",
    "/workspace",
    "--volume",
    `${resolve(sourceDir)}:/workspace:ro`,
    "--entrypoint",
    command[0],
    policy.image,
    ...command.slice(1),
  ];
}

export async function probeDoctor({ image = DEFAULT_SANDBOX_POLICY.image, commandRunner = runHostCommand } = {}) {
  const checks = [];
  const version = await commandRunner("docker", ["version", "--format", "{{.Client.Version}}"]);
  const dockerCliAvailable = version.exit_code === 0;
  checks.push({
    name: "docker_cli_available",
    status: dockerCliAvailable ? "ok" : "failed",
    reason: dockerCliAvailable ? `Docker CLI version ${version.stdout.trim() || "unknown"} detected.` : version.stderr || version.error || "Docker CLI is unavailable.",
  });

  let imageAvailable = false;
  let imageDigest = null;
  if (dockerCliAvailable) {
    const inspect = await commandRunner("docker", ["image", "inspect", image, "--format", "{{json .RepoDigests}}"]);
    imageAvailable = inspect.exit_code === 0;
    if (imageAvailable) {
      imageDigest = parseImageDigest(inspect.stdout) ?? image;
    }
    checks.push({
      name: "sandbox_image_local",
      status: imageAvailable ? "ok" : "warning",
      reason: imageAvailable
        ? `Image ${image} is available locally; Docker runner uses --pull never.`
        : `Image ${image} is not available locally; probes will fail closed because Docker pulls are disabled.`,
    });
  } else {
    checks.push({
      name: "sandbox_image_local",
      status: "warning",
      reason: "Image availability was not checked because Docker CLI is unavailable.",
    });
  }

  const failed = checks.some((check) => check.status === "failed");
  const warnings = checks.some((check) => check.status === "warning");
  return {
    status: failed ? "failed" : warnings ? "warning" : "ok",
    docker_cli_available: dockerCliAvailable,
    docker_version: dockerCliAvailable ? version.stdout.trim() || null : null,
    image,
    image_available: imageAvailable,
    image_digest: imageDigest,
    checks,
  };
}

async function stageCandidateSource({ report, candidateId, policy, fetchImpl }) {
  const candidate = report.candidates.find((item) => item.candidate_id === candidateId);
  const archiveBuffer = await fetchCandidateArchiveBuffer({ policy, candidate, fetchImpl });
  const zipEntries = parseZipArchiveEntries(archiveBuffer);
  const manifest = zipEntries.map((entry) => ({
    path: entry.path,
    size: entry.size,
    type: entry.type,
    compressed_size: entry.compressed_size,
    method: entry.method,
  }));
  const validation = validateArchiveManifestEntries(manifest, { policy });
  const sourceDir = await mkdtemp(join(tmpdir(), "scout-probe-source-"));
  await extractSafeZipEntries({ archiveBuffer, zipEntries, validation, outputDir: sourceDir });
  return { sourceDir };
}

function assertSandboxLifecycleAllowed(policy, approvalId) {
  for (const operation of [
    "sandbox_create",
    "sandbox_source_stage",
    "sandbox_command_run",
    "sandbox_artifact_read",
    "sandbox_destroy",
  ]) {
    assertAllowed(policy, operation, approvalId);
  }
}

function hasStaticInspectionEvidence(candidate, evidence) {
  if (["static_docs_ok", "static_docs_risky"].includes(candidate.static_inspection_status)) {
    return true;
  }
  return evidence.some(
    (item) => item.candidate_id === candidate.candidate_id && item.source_type === "STATIC_FILE",
  );
}

function readonlyCommandsForCandidate(candidate) {
  const intelligence = setupIntelligenceFromCandidate(candidate);
  const signals = [
    candidate.primary_language,
    ...(intelligence.ecosystems ?? []),
    ...(intelligence.package_managers ?? []),
    ...(intelligence.workspace?.manifest_paths ?? []),
    ...(candidate.labels ?? []),
    ...(candidate.source_observations ?? []).map((item) => `${item.kind} ${item.value}`),
  ].join(" ").toLowerCase();
  const commands = [];
  if (/\b(?:javascript|typescript|node|npm|package\.json|package-lock|pnpm|yarn)\b/.test(signals)) {
    commands.push(["node", "--version"], ["npm", "--version"]);
  }
  if (/\b(?:python|pyproject|requirements|pip)\b/.test(signals)) {
    commands.push(["python", "--version"]);
  }
  if (commands.length === 0) {
    commands.push(["node", "--version"], ["python", "--version"]);
  }
  return dedupeCommands(commands);
}

function deniedCommandsFromStaticObservations(candidate) {
  const structured = setupIntelligenceFromCandidate(candidate).denied_commands ?? [];
  if (structured.length > 0) {
    return structured.map((item) => ({
      command: item.command,
      reason: item.reason,
      ...(item.source_ref ? { source_ref: item.source_ref } : {}),
      ...(item.source_range ? { source_range: item.source_range } : {}),
      ...(item.category ? { category: item.category } : {}),
    }));
  }
  const text = (candidate.source_observations ?? [])
    .map((item) => `${item.kind} ${item.value}`)
    .join("\n");
  const denied = [];
  addDeniedIf(text, /\bnpm\s+install\b/i, ["npm", "install"], "Package installs are blocked in no-network readonly probes.");
  addDeniedIf(text, /\bpip\s+install\b/i, ["pip", "install"], "Package installs are blocked in no-network readonly probes.");
  addDeniedIf(text, /\bmake\s+test\b/i, ["make", "test"], "Repo-defined test targets are blocked in the readonly command set.");
  addDeniedIf(text, /\bdocker\s+compose\s+up\b/i, ["docker", "compose", "up"], "Nested Docker and external services are blocked.");
  addDeniedIf(text, /\bcurl\b[^\n|]*\|\s*(?:bash|sh)\b/i, ["curl", "|", "bash"], "Shell pipeline install commands are blocked.");
  return denied;

  function addDeniedIf(source, pattern, command, reason) {
    if (pattern.test(source)) {
      denied.push({ command, reason });
    }
  }
}

function dedupeCommands(commands) {
  const seen = new Set();
  return commands.filter((command) => {
    const key = command.join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createSandboxRun({ sandbox, plan, status, cleanupStatus, destroyedAt = null }) {
  return {
    sandbox_id: sandbox.sandbox_id,
    image: sandbox.image,
    image_ref: plan.sandbox_policy.image,
    image_digest: sandbox.image_digest ?? null,
    created_at: sandbox.created_at,
    destroyed_at: destroyedAt,
    cleanup_status: cleanupStatus,
    lifecycle_status: status,
    network_policy: plan.network_policy,
    resource_limits: {
      timeout_seconds: plan.sandbox_policy.timeout_seconds,
      cpu_count: plan.sandbox_policy.cpu_count,
      memory_mb: plan.sandbox_policy.memory_mb,
      pids_limit: plan.sandbox_policy.pids_limit,
      disk_mb: plan.sandbox_policy.disk_mb,
    },
  };
}

function commandAttemptFromResult({ candidateId, command, approvalId, sandbox, startedAt, result }) {
  const endedAt = new Date().toISOString();
  const status = result.result === "passed" ? "passed" : result.result === "timeout" ? "failed" : "failed";
  return {
    command_id: result.command_id,
    candidate_id: candidateId,
    command,
    status,
    reason: result.reason,
    observed_at: endedAt,
    approval_id: approvalId,
    sandbox_id: sandbox.sandbox_id,
    source_ref: "Scout readonly command allowlist",
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms: result.duration_ms,
    exit_code: result.exit_code,
    stdout_artifact: result.stdout_artifact,
    stderr_artifact: result.stderr_artifact,
    result: result.result,
  };
}

async function runDockerCommand({ policy, sourceDir, command, stdoutArtifact, stderrArtifact, timeoutSeconds }) {
  return new Promise((resolvePromise, reject) => {
    const args = buildDockerRunArgs({ policy, sourceDir, command });
    const child = spawn("docker", args, { env: safeHostEnv(), shell: false, windowsHide: true });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, Math.max(1, timeoutSeconds) * 1000);

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", async (code) => {
      clearTimeout(timer);
      await writeFile(stdoutArtifact, Buffer.concat(stdout));
      await writeFile(stderrArtifact, Buffer.concat(stderr));
      resolvePromise({ exit_code: timedOut ? 124 : code ?? 1, timed_out: timedOut });
    });
  });
}

async function runHostCommand(command, args) {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, { env: safeHostEnv(), shell: false, windowsHide: true });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      resolveResult({
        exit_code: 1,
        stdout: "",
        stderr: "",
        error: error.message,
      });
    });
    child.on("close", (code) => {
      resolveResult({
        exit_code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

function parseImageDigest(raw) {
  try {
    const parsed = JSON.parse(String(raw ?? "").trim());
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "string") {
      return parsed[0];
    }
  } catch {
    return null;
  }
  return null;
}

function safeHostEnv() {
  return {
    PATH: process.env.PATH ?? "",
    Path: process.env.Path ?? process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
    WINDIR: process.env.WINDIR ?? "",
  };
}

function sanitizeId(value) {
  return basename(String(value).replace(/[^A-Za-z0-9._-]+/g, "-")).slice(0, 120) || "probe";
}

function formatArgv(command) {
  return Array.isArray(command) ? command.join(" ") : String(command);
}
