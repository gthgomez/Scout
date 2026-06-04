import { assertAllowed } from "./policy.js";

export const STATIC_FILE_ALLOWLIST = Object.freeze([
  /^README(?:\.[A-Za-z0-9._-]+)?$/i,
  /^CHANGELOG(?:\.[A-Za-z0-9._-]+)?$/i,
  /^LICENSE(?:\.[A-Za-z0-9._-]+)?$/i,
  /^CONTRIBUTING(?:\.[A-Za-z0-9._-]+)?$/i,
  /^SECURITY(?:\.[A-Za-z0-9._-]+)?$/i,
  /^CODE_OF_CONDUCT(?:\.[A-Za-z0-9._-]+)?$/i,
  /^CODEOWNERS$/i,
  /^\.?github\/workflows\/[A-Za-z0-9._-]+\.(?:ya?ml)$/i,
  /^\.?github\/(PULL_REQUEST_TEMPLATE|ISSUE_TEMPLATE|FUNDING)\.md$/i,
  /^docs\/[^\0\/]+(?:\/[^\0\/]+)*\.(?:md|markdown|txt|yml|yaml|toml|json|cfg|ini)$/i,
  /^examples\/[^\0\/]+(?:\/[^\0\/]+)*\.(?:md|markdown|txt|yml|yaml|toml)$/i,
  /^(?:[A-Za-z0-9._-]+\/)*\.env\.(example|sample)$/i,
  /^package\.json$/i,
  /^pyproject\.toml$/i,
  /^requirements(?:-dev)?\.txt$/i,
  /^setup\.cfg$/i,
  /^setup\.py$/i,
  /^Cargo\.toml$/i,
  /^go\.mod$/i,
  /^pom\.xml$/i,
  /^build\.gradle(?:\.kts)?$/i,
]);

const SIZE_FIELDS = Object.freeze(["size_bytes", "sizeBytes", "size"]);
const PATH_FIELDS = Object.freeze(["path", "name", "file", "filename", "pathname"]);
const LINK_FIELDS = Object.freeze(["link", "link_to", "link_to_path", "linkTarget", "linkname", "target"]);
const TYPE_FIELDS = Object.freeze(["type", "typeflag", "entry_type"]);
const DIRECTORY_TYPES = Object.freeze(["directory", "dir", "5", 5, "d"]);
const SYMLINK_TYPES = Object.freeze(["symlink", "symbolic", "symbolic link", "2", 2, "l"]);

function readManifestField(entry, fields, fallback = undefined) {
  for (const field of fields) {
    if (entry?.[field] !== undefined) {
      return entry[field];
    }
  }
  return fallback;
}

function normalizeArchivePath(filePath) {
  if (typeof filePath !== "string") return "";
  return filePath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "");
}

function decodeArchivePath(filePath) {
  if (typeof filePath !== "string") return "";
  try {
    return decodeURIComponent(filePath);
  } catch {
    return filePath;
  }
}

function hasTraversalSegment(filePath) {
  return filePath.split("/").some((segment) => segment === "..");
}

function parseManifestSize(entry) {
  const rawSize = readManifestField(entry, SIZE_FIELDS, 0);
  const size = Number(rawSize);
  if (!Number.isFinite(size) || size < 0) {
    return NaN;
  }
  return size;
}

function entryType(entry) {
  const type = readManifestField(entry, TYPE_FIELDS, "");
  if (type === null || type === undefined || type === "") {
    return "";
  }
  if (typeof type === "string" || typeof type === "number") {
    return String(type).toLowerCase();
  }
  return "";
}

function isDirectoryEntry(entry) {
  const path = readManifestField(entry, PATH_FIELDS, "");
  const type = entryType(entry);
  const normalizedPath = normalizeArchivePath(path);
  return (
    DIRECTORY_TYPES.some((directoryType) => String(directoryType) === type) ||
    normalizedPath.endsWith("/") ||
    normalizedPath.endsWith("\\")
  );
}

export function assertStaticInspectionAllowed(policy, approvalId = null) {
  assertAllowed(policy, "archive_download", approvalId);
  assertAllowed(policy, "static_file_read", approvalId);
  return true;
}

export function isArchiveAbsolutePath(filePath) {
  const normalizedPath = normalizeArchivePath(filePath);
  const decodedPath = normalizeArchivePath(decodeArchivePath(filePath));
  if (!normalizedPath) {
    return false;
  }
  return /^(?:\/|[A-Za-z]:\/|\\\\|\/\/)/.test(normalizedPath) || /^(?:\/|[A-Za-z]:\/|\\\\|\/\/)/.test(decodedPath);
}

export function isArchivePathTraversal(filePath) {
  const normalizedPath = normalizeArchivePath(filePath);
  const decodedPath = normalizeArchivePath(decodeArchivePath(filePath));
  return hasTraversalSegment(normalizedPath) || hasTraversalSegment(decodedPath);
}

export function isSymlinkEscape(entry) {
  const type = entryType(entry);
  const isSymlink = SYMLINK_TYPES.includes(type) || entry?.isSymlink === true;
  if (!isSymlink) {
    return false;
  }
  const target = readManifestField(entry, LINK_FIELDS);
  if (typeof target !== "string" || target.trim().length === 0) {
    return true;
  }
  return isArchiveAbsolutePath(target) || isArchivePathTraversal(target);
}

export function isAllowedStaticFilePath(filePath, patterns = STATIC_FILE_ALLOWLIST) {
  const normalizedPath = normalizeArchivePath(filePath);
  if (!normalizedPath || isDirectoryEntry({ path: normalizedPath })) {
    return false;
  }
  return patterns.some((pattern) => pattern.test(normalizedPath));
}

export function enforceArchiveLimits(fileCount, totalSizeBytes, policy) {
  const maxArchiveMb = Number(policy?.limits?.static_archive_max_mb);
  const maxFileCount = Number(policy?.limits?.static_file_count_max);
  const maxBytes = Number.isFinite(maxArchiveMb) ? maxArchiveMb * 1024 * 1024 : Number.POSITIVE_INFINITY;
  const maxCount = Number.isFinite(maxFileCount) ? maxFileCount : Number.POSITIVE_INFINITY;

  if (!Number.isFinite(fileCount) || !Number.isInteger(fileCount) || fileCount < 0) {
    const error = new Error("Archive file count is invalid.");
    error.code = "SCOUT_STATIC_ARCHIVE_COUNT_INVALID";
    throw error;
  }

  if (!Number.isFinite(totalSizeBytes) || totalSizeBytes < 0) {
    const error = new Error("Archive size total is invalid.");
    error.code = "SCOUT_STATIC_ARCHIVE_SIZE_INVALID";
    throw error;
  }

  if (fileCount > maxCount) {
    const error = new Error(`Archive file-count limit exceeded: ${fileCount} > ${maxCount}.`);
    error.code = "SCOUT_STATIC_FILE_COUNT_LIMIT";
    error.details = { fileCount, maxFileCount: maxCount };
    throw error;
  }

  if (totalSizeBytes > maxBytes) {
    const error = new Error(`Archive size limit exceeded: ${totalSizeBytes} > ${maxBytes}.`);
    error.code = "SCOUT_STATIC_ARCHIVE_SIZE_LIMIT";
    error.details = { totalSizeBytes, maxBytes };
    throw error;
  }

  return {
    maxFileCount: maxCount,
    maxSizeBytes: maxBytes,
  };
}

export function validateArchiveManifestEntries(manifestEntries, options = {}) {
  const policy = options.policy;
  const patterns = options.allowedPatterns ?? STATIC_FILE_ALLOWLIST;

  if (policy) {
    assertStaticInspectionAllowed(policy);
  }

  if (!Array.isArray(manifestEntries)) {
    throw new TypeError("Manifest must be an array of entries.");
  }

  const entries = manifestEntries.map((entry, index) => {
    const pathValue = readManifestField(entry, PATH_FIELDS, "");
    const normalizedPath = normalizeArchivePath(pathValue);
    const isDirectory = isDirectoryEntry(entry);
    const sizeBytes = parseManifestSize(entry);
    const reasons = [];

    if (typeof pathValue !== "string" || pathValue.trim().length === 0) {
      reasons.push("missing path");
    } else if (isArchiveAbsolutePath(pathValue)) {
      reasons.push("absolute path");
    } else if (isArchivePathTraversal(pathValue)) {
      reasons.push("path traversal");
    } else if (!isDirectory && !isAllowedStaticFilePath(normalizedPath, patterns)) {
      reasons.push("path not in static file allowlist");
    }

    if (isSymlinkEscape(entry)) {
      reasons.push("symlink escapes archive");
    }

    if (!Number.isFinite(sizeBytes)) {
      reasons.push("invalid size");
    }

    return {
      index,
      original_path: pathValue,
      normalized_path: normalizedPath,
      size_bytes: sizeBytes,
      is_directory: isDirectory,
      is_symlink: SYMLINK_TYPES.includes(entryType(entry)) || entry?.isSymlink === true,
      safe: reasons.length === 0,
      reasons,
    };
  });

  const fileCount = entries.reduce((count, entry) => (entry.is_directory ? count : count + 1), 0);
  const totalSizeBytes = entries.reduce(
    (total, entry) => (entry.is_directory ? total : Number.isFinite(entry.size_bytes) ? total + entry.size_bytes : total),
    0,
  );

  if (policy) {
    enforceArchiveLimits(fileCount, totalSizeBytes, policy);
  }

  return {
    entries,
    safe_entries: entries.filter((entry) => entry.safe),
    unsafe_entries: entries.filter((entry) => !entry.safe),
    file_count: fileCount,
    total_size_bytes: totalSizeBytes,
  };
}

export function inspectArchiveStub({ policy, manifest = [] }) {
  const validation = validateArchiveManifestEntries(manifest, { policy });
  return {
    setup_status: validation.unsafe_entries.length ? "not_executed" : "unknown",
    observations: validation.entries.map((entry) => ({
      path: entry.normalized_path || entry.original_path,
      safe: entry.safe,
      reasons: entry.reasons,
    })),
    validation,
    note: validation.unsafe_entries.length ? "Archive manifest validation found unsafe entries." : "Archive manifest validation completed.",
  };
}

export function inspectCandidateStaticManifest({ policy, candidate, manifest = [] }) {
  if (!Array.isArray(manifest)) {
    return {
      ...candidate,
      static_inspection_status: "missing_manifest",
      collection_status: "PARTIAL",
      source_observations: [
        ...(candidate.source_observations ?? []),
        { kind: "static_manifest_missing", value: "No static manifest was supplied for this candidate." },
      ],
      static_inspection: {
        setup_status: "unknown",
        file_count: 0,
        total_size_bytes: 0,
        unsafe_entry_count: 0,
        useful_static_evidence: false,
      },
    };
  }
  const inspection = inspectArchiveStub({ policy, manifest });
  const safePaths = new Set(inspection.validation.safe_entries.map((entry) => entry.normalized_path.toLowerCase()));
  const observations = [...(candidate.source_observations ?? [])];

  pushStaticObservation(observations, "static_manifest_validated", inspection.note);
  if (hasAnyPath(safePaths, [/^readme(?:\.[a-z0-9._-]+)?$/])) {
    pushStaticObservation(observations, "setup_docs", "README present in static manifest.");
  }
  if (hasAnyPath(safePaths, [/^contributing(?:\.[a-z0-9._-]+)?$/])) {
    pushStaticObservation(observations, "contributor_guide", "CONTRIBUTING guide present in static manifest.");
  }
  if (hasAnyPath(safePaths, [/^\.?github\/workflows\/.+\.ya?ml$/])) {
    pushStaticObservation(observations, "tests_present", "GitHub workflow present in static manifest.");
  }
  if (hasAnyPath(safePaths, [/^package\.json$/, /^pyproject\.toml$/, /^requirements(?:-dev)?\.txt$/, /^cargo\.toml$/])) {
    pushStaticObservation(observations, "setup_docs", "Recognized project manifest present in static manifest.");
  }
  if (inspection.validation.unsafe_entries.length > 0) {
    pushStaticObservation(
      observations,
      "static_manifest_warning",
      `${inspection.validation.unsafe_entries.length} unsafe archive entries were blocked.`,
    );
  }
  const usefulStaticEvidence = observations.some((item) =>
    ["setup_docs", "contributor_guide", "tests_present"].includes(item.kind),
  );
  const staticInspectionStatus = inspection.validation.unsafe_entries.length > 0
    ? "static_docs_risky"
    : usefulStaticEvidence
      ? "static_docs_ok"
      : "insufficient_static_evidence";

  return {
    ...candidate,
    source_observations: observations,
    collection_status: candidate.collection_status === "FAILED" || staticInspectionStatus === "insufficient_static_evidence"
      ? "PARTIAL"
      : candidate.collection_status,
    static_inspection_status: staticInspectionStatus,
    static_inspection: {
      setup_status: staticInspectionStatus === "static_docs_ok" ? "static_docs_ok" : "unknown",
      file_count: inspection.validation.file_count,
      total_size_bytes: inspection.validation.total_size_bytes,
      unsafe_entry_count: inspection.validation.unsafe_entries.length,
      useful_static_evidence: usefulStaticEvidence,
    },
  };
}

export function evidenceFromStaticInspection(candidate) {
  const inspection = candidate.static_inspection;
  if (!inspection) return [];
  return [
    {
      evidence_id: `evidence-static-${candidate.candidate_id}`,
      candidate_id: candidate.candidate_id,
      source_type: "STATIC_FILE",
      source_ref: `${candidate.repo_owner}/${candidate.repo_name} archive manifest`,
      observed_at: new Date().toISOString(),
      trust_level: candidate.static_inspection_status === "static_docs_ok" ? "OBSERVED" : "UNKNOWN",
      claim: `Static inspection status ${candidate.static_inspection_status}: ${inspection.file_count} files, ${inspection.unsafe_entry_count} unsafe entries blocked.`,
      supports: candidate.static_inspection_status === "static_docs_ok" ? "static inspection evidence" : "static inspection uncertainty",
    },
  ];
}

function pushStaticObservation(observations, kind, value) {
  if (!observations.some((item) => item.kind === kind && item.value === value)) {
    observations.push({ kind, value });
  }
}

function hasAnyPath(paths, patterns) {
  for (const path of paths) {
    if (patterns.some((pattern) => pattern.test(path))) {
      return true;
    }
  }
  return false;
}

export function dynamicProbeUnavailable() {
  const error = new Error("Dynamic probing is not implemented. Release 2 requires an enforceable sandbox contract.");
  error.code = "SCOUT_DYNAMIC_PROBE_UNAVAILABLE";
  throw error;
}
