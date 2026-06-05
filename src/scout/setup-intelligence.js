const DOC_PATH_PATTERN = /^(?:readme|contributing)(?:\.[a-z0-9._-]+)?$|^(?:docs|examples)\//i;
const SETUP_WORD_PATTERN = /\b(setup|install|getting started|development|develop|test|contributing)\b/i;
const PROMPT_INJECTION_PATTERN =
  /\b(ignore (?:all )?(?:previous|prior) instructions|reveal (?:the )?(?:secret|token|password)|disable (?:logs|logging|audit)|fetch remote (?:instructions|rules)|system prompt)\b/i;
const PRIVATE_CREDENTIAL_PATTERN = /\b(?:[a-z0-9]+[_-])*(?:api[_ -]?key|secret|token|password)\b/i;
const PRIVATE_SERVICE_PATTERN = /\b(stripe|supabase|firebase|aws|gcp|azure|openai|anthropic|sentry|datadog)\b/i;

const DENIED_COMMAND_PATTERNS = Object.freeze([
  {
    pattern: /\bnpm\s+(?:install|ci)\b/i,
    command: ["npm", "install"],
    reason: "Package installs are blocked in no-network readonly probes.",
    category: "package_install",
  },
  {
    pattern: /\bpnpm\s+install\b/i,
    command: ["pnpm", "install"],
    reason: "Package installs are blocked in no-network readonly probes.",
    category: "package_install",
  },
  {
    pattern: /\byarn\s+(?:install|add)\b/i,
    command: ["yarn", "install"],
    reason: "Package installs are blocked in no-network readonly probes.",
    category: "package_install",
  },
  {
    pattern: /\bpip(?:3)?\s+install\b/i,
    command: ["pip", "install"],
    reason: "Package installs are blocked in no-network readonly probes.",
    category: "package_install",
  },
  {
    pattern: /\bpoetry\s+install\b/i,
    command: ["poetry", "install"],
    reason: "Package installs are blocked in no-network readonly probes.",
    category: "package_install",
  },
  {
    pattern: /\bmake\s+test\b/i,
    command: ["make", "test"],
    reason: "Repo-defined test targets are blocked in the readonly command set.",
    category: "repo_script",
  },
  {
    pattern: /\bdocker\s+compose\s+up\b|\bdocker-compose\s+up\b/i,
    command: ["docker", "compose", "up"],
    reason: "Nested Docker and external services are blocked.",
    category: "nested_docker",
  },
  {
    pattern: /\bcurl\b[^\n|]*\|\s*(?:bash|sh)\b/i,
    command: ["curl", "|", "bash"],
    reason: "Shell pipeline install commands are blocked.",
    category: "shell_pipeline",
  },
]);

export function analyzeStaticFileSetupIntelligence(filePath, content) {
  const text = Buffer.isBuffer(content)
    ? content.toString("utf8", 0, Math.min(content.byteLength, 1024 * 1024))
    : String(content ?? "");
  const normalizedPath = normalizePath(filePath);
  const lowerPath = normalizedPath.toLowerCase();
  const intelligence = emptySetupIntelligence();

  addPathSignals(intelligence, normalizedPath);
  addDeniedCommands(intelligence, normalizedPath, text);

  if (DOC_PATH_PATTERN.test(lowerPath) && SETUP_WORD_PATTERN.test(text)) {
    intelligence.setup_claims.push({
      kind: "setup_docs",
      source_ref: normalizedPath,
      detail: `${normalizedPath} contains setup or development guidance.`,
      confidence: "observed",
    });
  }

  if (PROMPT_INJECTION_PATTERN.test(text)) {
    addRiskSignal(intelligence, "prompt_injection", normalizedPath, `${normalizedPath} contains prompt-injection style text.`);
  }
  if (/\bcurl\b[^\n|]*\|\s*(?:bash|sh)\b/i.test(text)) {
    addRiskSignal(intelligence, "shell_pipeline", normalizedPath, `${normalizedPath} suggests piping remote content to a shell.`);
  }
  if (PRIVATE_CREDENTIAL_PATTERN.test(text) && /\b(required|must|need|set|configure|create|copy)\b/i.test(text)) {
    addRiskSignal(intelligence, "private_credentials", normalizedPath, `${normalizedPath} appears to require private credentials.`);
  }
  if (PRIVATE_SERVICE_PATTERN.test(text) && /\b(required|must|need|account|project|service)\b/i.test(text)) {
    addRiskSignal(intelligence, "private_service", normalizedPath, `${normalizedPath} appears to require a private or paid external service.`);
  }
  if (/\b(?:create|copy|configure|set up)\s+(?:a\s+)?\.env\b/i.test(text) && !/\.env\.(?:example|sample)\b/i.test(text)) {
    addRiskSignal(intelligence, "hidden_env", normalizedPath, `${normalizedPath} references a required .env file without a visible example.`);
  }

  if (lowerPath === "package.json") {
    analyzePackageJson(intelligence, normalizedPath, text);
  }

  return finalizeSetupIntelligence(intelligence);
}

export function setupIntelligenceFromPaths(paths) {
  const intelligence = emptySetupIntelligence();
  for (const path of paths ?? []) {
    addPathSignals(intelligence, normalizePath(path));
  }
  return finalizeSetupIntelligence(intelligence);
}

export function mergeSetupIntelligence(items) {
  const merged = emptySetupIntelligence();
  for (const item of items ?? []) {
    if (!item || typeof item !== "object") continue;
    for (const ecosystem of item.ecosystems ?? []) addUnique(merged.ecosystems, ecosystem);
    for (const manager of item.package_managers ?? []) addUnique(merged.package_managers, manager);
    for (const path of item.workspace?.manifest_paths ?? []) addUnique(merged.workspace.manifest_paths, path);
    for (const path of item.workspace?.test_paths ?? []) addUnique(merged.workspace.test_paths, path);
    for (const claim of item.setup_claims ?? []) pushUniqueObject(merged.setup_claims, claim, ["kind", "source_ref", "detail"]);
    for (const command of item.denied_commands ?? []) pushUniqueObject(merged.denied_commands, command, ["command", "source_ref", "source_range"]);
    for (const signal of item.risk_signals ?? []) pushUniqueObject(merged.risk_signals, signal, ["kind", "source_ref", "detail"]);
    if (item.workspace?.kind && item.workspace.kind !== "unknown") {
      merged.workspace.kind = mergeWorkspaceKind(merged.workspace.kind, item.workspace.kind);
    }
  }
  return finalizeSetupIntelligence(merged);
}

export function setupIntelligenceFromCandidate(candidate) {
  const existing = candidate?.static_inspection?.setup_intelligence;
  if (existing && typeof existing === "object") {
    return finalizeSetupIntelligence(existing);
  }
  const fromObservations = emptySetupIntelligence();
  const observationText = (candidate?.source_observations ?? []).map((item) => `${item.kind} ${item.value}`).join("\n");
  if (/\b(?:javascript|typescript|node|npm|package\.json|pnpm|yarn)\b/i.test(observationText)) {
    addUnique(fromObservations.ecosystems, "node");
  }
  if (/\b(?:python|pyproject|requirements|pip)\b/i.test(observationText)) {
    addUnique(fromObservations.ecosystems, "python");
  }
  addDeniedCommands(fromObservations, "source_observations", observationText);
  return finalizeSetupIntelligence(fromObservations);
}

function emptySetupIntelligence() {
  return {
    schema_version: 1,
    ecosystems: [],
    package_managers: [],
    workspace: {
      kind: "unknown",
      manifest_paths: [],
      test_paths: [],
    },
    setup_claims: [],
    denied_commands: [],
    risk_signals: [],
    recommended_next_evidence_action: {
      action: "static_inspection",
      reason: "Scout needs more static setup evidence before dynamic probing.",
    },
  };
}

function addPathSignals(intelligence, filePath) {
  const lowerPath = filePath.toLowerCase();
  if (lowerPath === "package.json") {
    addUnique(intelligence.ecosystems, "node");
    addUnique(intelligence.workspace.manifest_paths, filePath);
    addUnique(intelligence.package_managers, "npm");
  } else if (lowerPath === "package-lock.json") {
    addUnique(intelligence.package_managers, "npm");
  } else if (lowerPath === "pnpm-lock.yaml" || lowerPath === "pnpm-workspace.yaml") {
    addUnique(intelligence.package_managers, "pnpm");
    if (lowerPath === "pnpm-workspace.yaml") intelligence.workspace.kind = mergeWorkspaceKind(intelligence.workspace.kind, "monorepo");
  } else if (lowerPath === "yarn.lock") {
    addUnique(intelligence.package_managers, "yarn");
  } else if (lowerPath === "pyproject.toml" || lowerPath === "setup.py" || lowerPath === "setup.cfg" || /^requirements(?:-dev)?\.txt$/i.test(lowerPath)) {
    addUnique(intelligence.ecosystems, "python");
    addUnique(intelligence.workspace.manifest_paths, filePath);
    addUnique(intelligence.package_managers, lowerPath === "pyproject.toml" ? "poetry" : "pip");
  } else if (lowerPath === "cargo.toml") {
    addUnique(intelligence.ecosystems, "rust");
    addUnique(intelligence.package_managers, "cargo");
    addUnique(intelligence.workspace.manifest_paths, filePath);
  } else if (lowerPath === "go.mod" || lowerPath === "go.work") {
    addUnique(intelligence.ecosystems, "go");
    addUnique(intelligence.package_managers, "go");
    addUnique(intelligence.workspace.manifest_paths, filePath);
    if (lowerPath === "go.work") intelligence.workspace.kind = mergeWorkspaceKind(intelligence.workspace.kind, "monorepo");
  } else if (lowerPath === "pom.xml") {
    addUnique(intelligence.ecosystems, "java");
    addUnique(intelligence.package_managers, "maven");
    addUnique(intelligence.workspace.manifest_paths, filePath);
  } else if (/^build\.gradle(?:\.kts)?$/i.test(lowerPath)) {
    addUnique(intelligence.ecosystems, "java");
    addUnique(intelligence.package_managers, "gradle");
    addUnique(intelligence.workspace.manifest_paths, filePath);
  } else if (/^\.?github\/workflows\/.+\.ya?ml$/i.test(lowerPath) || /\btest\b/i.test(lowerPath)) {
    addUnique(intelligence.workspace.test_paths, filePath);
  } else if (DOC_PATH_PATTERN.test(lowerPath)) {
    addUnique(intelligence.ecosystems, "docs");
  }
}

function analyzePackageJson(intelligence, filePath, text) {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed.packageManager === "string") {
      addUnique(intelligence.package_managers, parsed.packageManager.split("@")[0]);
    }
    if (Array.isArray(parsed.workspaces) || parsed.workspaces?.packages) {
      intelligence.workspace.kind = mergeWorkspaceKind(intelligence.workspace.kind, "monorepo");
    }
    const scripts = parsed?.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {};
    for (const scriptName of ["preinstall", "install", "postinstall", "prepare"]) {
      if (typeof scripts[scriptName] === "string" && scripts[scriptName].trim()) {
        addRiskSignal(intelligence, "npm_lifecycle_script", filePath, `package.json defines ${scriptName}.`);
      }
    }
    if (typeof scripts.test === "string" && scripts.test.trim()) {
      addUnique(intelligence.workspace.test_paths, "package.json:scripts.test");
    }
  } catch {
    addRiskSignal(intelligence, "parse_warning", filePath, "package.json could not be parsed as JSON.");
  }
}

function addDeniedCommands(intelligence, sourceRef, text) {
  const lines = String(text ?? "").split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const definition of DENIED_COMMAND_PATTERNS) {
      if (!definition.pattern.test(line)) continue;
      pushUniqueObject(
        intelligence.denied_commands,
        {
          command: definition.command,
          reason: definition.reason,
          source_ref: sourceRef,
          source_range: `L${index + 1}`,
          category: definition.category,
        },
        ["command", "source_ref", "source_range"],
      );
    }
  });
}

function addRiskSignal(intelligence, kind, sourceRef, detail) {
  pushUniqueObject(intelligence.risk_signals, { kind, source_ref: sourceRef, detail }, ["kind", "source_ref", "detail"]);
}

function finalizeSetupIntelligence(input) {
  const intelligence = {
    ...emptySetupIntelligence(),
    ...input,
    workspace: {
      ...emptySetupIntelligence().workspace,
      ...(input?.workspace ?? {}),
    },
  };
  intelligence.ecosystems = dedupeStrings(intelligence.ecosystems);
  intelligence.package_managers = dedupeStrings(intelligence.package_managers);
  intelligence.workspace.manifest_paths = dedupeStrings(intelligence.workspace.manifest_paths);
  intelligence.workspace.test_paths = dedupeStrings(intelligence.workspace.test_paths);
  if (intelligence.workspace.kind === "unknown") {
    if (intelligence.workspace.manifest_paths.length > 0) {
      intelligence.workspace.kind = "single_package";
    } else if (intelligence.ecosystems.length === 1 && intelligence.ecosystems[0] === "docs") {
      intelligence.workspace.kind = "docs_only";
    }
  }
  intelligence.recommended_next_evidence_action = recommendedNextEvidenceAction(intelligence);
  return intelligence;
}

function recommendedNextEvidenceAction(intelligence) {
  const riskKinds = new Set((intelligence.risk_signals ?? []).map((item) => item.kind));
  if (riskKinds.has("private_credentials") || riskKinds.has("private_service") || riskKinds.has("hidden_env")) {
    return {
      action: "drop",
      reason: "Static setup evidence appears to require private credentials or hidden environment configuration.",
    };
  }
  if (riskKinds.size > 0) {
    return {
      action: "human_review",
      reason: "Static setup evidence includes risky instructions that require human review before probing.",
    };
  }
  if (((intelligence.setup_claims ?? []).length > 0 || (intelligence.ecosystems ?? []).includes("docs")) && hasRuntimeEcosystem(intelligence)) {
    return {
      action: "readonly_probe",
      reason: "Static setup evidence is present and the next safe check is a no-network readonly probe.",
    };
  }
  if (intelligence.workspace.kind === "docs_only") {
    return {
      action: "no_action",
      reason: "Only documentation evidence was found; no runtime probe is useful yet.",
    };
  }
  return {
    action: "static_inspection",
    reason: "Scout needs more static setup evidence before dynamic probing.",
  };
}

function hasRuntimeEcosystem(intelligence) {
  return (intelligence.ecosystems ?? []).some((ecosystem) => ecosystem !== "docs" && ecosystem !== "unknown");
}

function mergeWorkspaceKind(current, next) {
  if (current === "monorepo" || next === "monorepo") return "monorepo";
  if (current === "single_package" || next === "single_package") return "single_package";
  if (current === "docs_only" || next === "docs_only") return "docs_only";
  return "unknown";
}

function addUnique(array, value) {
  const normalized = String(value ?? "").trim();
  if (normalized && !array.includes(normalized)) {
    array.push(normalized);
  }
}

function pushUniqueObject(array, value, fields) {
  const key = fields.map((field) => JSON.stringify(value[field])).join("\u0000");
  if (!array.some((item) => fields.map((field) => JSON.stringify(item[field])).join("\u0000") === key)) {
    array.push(value);
  }
}

function dedupeStrings(values) {
  return [...new Set((values ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function normalizePath(filePath) {
  return String(filePath ?? "").replace(/\\/g, "/").replace(/^\.\/+/, "");
}
