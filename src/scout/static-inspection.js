import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { assertAllowed } from "./policy.js";
import {
  analyzeStaticFileSetupIntelligence,
  mergeSetupIntelligence,
  setupIntelligenceFromPaths,
} from "./setup-intelligence.js";

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
  /^docs\/[^\0/]+(?:\/[^\0/]+)*\.(?:md|markdown|txt|yml|yaml|toml|json|cfg|ini)$/i,
  /^examples\/[^\0/]+(?:\/[^\0/]+)*\.(?:md|markdown|txt|yml|yaml|toml)$/i,
  /^(?:[A-Za-z0-9._-]+\/)*\.env\.(example|sample)$/i,
  /^package\.json$/i,
  /^package-lock\.json$/i,
  /^pnpm-lock\.yaml$/i,
  /^pnpm-workspace\.yaml$/i,
  /^yarn\.lock$/i,
  /^pyproject\.toml$/i,
  /^requirements(?:-dev)?\.txt$/i,
  /^setup\.cfg$/i,
  /^setup\.py$/i,
  /^Makefile$/i,
  /^Dockerfile$/i,
  /^docker-compose\.ya?ml$/i,
  /^Cargo\.toml$/i,
  /^go\.mod$/i,
  /^go\.work$/i,
  /^pom\.xml$/i,
  /^build\.gradle(?:\.kts)?$/i,
  /^turbo\.json$/i,
  /^nx\.json$/i,
]);

const SIZE_FIELDS = Object.freeze(["size_bytes", "sizeBytes", "size"]);
const PATH_FIELDS = Object.freeze(["path", "name", "file", "filename", "pathname"]);
const LINK_FIELDS = Object.freeze(["link", "link_to", "link_to_path", "linkTarget", "linkname", "target"]);
const TYPE_FIELDS = Object.freeze(["type", "typeflag", "entry_type"]);
const DIRECTORY_TYPES = Object.freeze(["directory", "dir", "5", 5, "d"]);
const SYMLINK_TYPES = Object.freeze(["symlink", "symbolic", "symbolic link", "2", 2, "l"]);
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP_STORED = 0;
const ZIP_DEFLATED = 8;

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

function stripArchiveRootPrefix(filePath) {
  const normalizedPath = normalizeArchivePath(filePath);
  const segments = normalizedPath.split("/").filter(Boolean);
  if (segments.length <= 1) {
    return normalizedPath;
  }
  return segments.slice(1).join("/");
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
  assertAllowed(policy, "static_source_fetch", approvalId);
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
  const withoutArchiveRoot = stripArchiveRootPrefix(normalizedPath);
  return patterns.some((pattern) => pattern.test(normalizedPath) || pattern.test(withoutArchiveRoot));
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
    const static_path = stripArchiveRootPrefix(normalizedPath);
    const isDirectory = isDirectoryEntry(entry);
    const sizeBytes = parseManifestSize(entry);
    const reasons = [];
    let ignored = false;

    if (typeof pathValue !== "string" || pathValue.trim().length === 0) {
      reasons.push("missing path");
    } else if (isArchiveAbsolutePath(pathValue)) {
      reasons.push("absolute path");
    } else if (isArchivePathTraversal(pathValue)) {
      reasons.push("path traversal");
    } else if (!isDirectory && !isAllowedStaticFilePath(normalizedPath, patterns)) {
      ignored = true;
    }

    if (isSymlinkEscape(entry)) {
      reasons.push("symlink escapes archive");
    }

    if (!Number.isFinite(sizeBytes)) {
      reasons.push("invalid size");
    }

    ignored = ignored && reasons.length === 0;

    return {
      index,
      original_path: pathValue,
      normalized_path: normalizedPath,
      static_path,
      size_bytes: sizeBytes,
      is_directory: isDirectory,
      is_symlink: SYMLINK_TYPES.includes(entryType(entry)) || entry?.isSymlink === true,
      ignored,
      safe: reasons.length === 0 && !ignored,
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
    unsafe_entries: entries.filter((entry) => entry.reasons.length > 0),
    ignored_entries: entries.filter((entry) => entry.ignored),
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
  const safePaths = new Set(
    inspection.validation.safe_entries.flatMap((entry) =>
      [entry.normalized_path, entry.static_path].filter(Boolean).map((path) => path.toLowerCase()),
    ),
  );
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
  if (inspection.validation.ignored_entries.length > 0) {
    pushStaticObservation(
      observations,
      "static_manifest_ignored",
      `${inspection.validation.ignored_entries.length} archive entries were outside the static inspection allowlist.`,
    );
  }
  const usefulStaticEvidence = observations.some((item) =>
    ["setup_docs", "contributor_guide", "tests_present"].includes(item.kind),
  );
  const setupIntelligence = setupIntelligenceFromPaths([...safePaths]);
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
      setup_intelligence: setupIntelligence,
    },
  };
}

export async function inspectCandidateStaticArchive({
  policy,
  candidate,
  fetchImpl = globalThis.fetch,
  tempRoot = tmpdir(),
  keepTemp = false,
}) {
  assertStaticInspectionAllowed(policy);
  let tempDir = null;
  try {
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
    tempDir = await mkdtemp(join(tempRoot, "scout-static-"));
    const extractedFiles = await extractSafeZipEntries({
      archiveBuffer,
      zipEntries,
      validation,
      outputDir: tempDir,
    });
    const inspected = inspectCandidateStaticManifest({ policy, candidate, manifest });
    const cleanedUp = keepTemp ? false : await cleanupTempDir(tempDir);
    if (cleanedUp) {
      tempDir = null;
    }
    return addArchiveInspectionDetails(inspected, {
      archive_url: buildGitHubArchiveUrl(candidate),
      extracted_files: extractedFiles,
      temp_dir: keepTemp ? tempDir : null,
      cleanup_status: cleanedUp ? "removed" : "retained",
    });
  } catch (error) {
    if (error.code === "SCOUT_POLICY_DENIED") {
      throw error;
    }
    if (tempDir && !keepTemp) {
      await cleanupTempDir(tempDir);
    }
    return {
      ...candidate,
      collection_status: "PARTIAL",
      static_inspection_status: "insufficient_static_evidence",
      source_observations: [
        ...(candidate.source_observations ?? []),
        { kind: "static_archive_error", value: error.message },
      ],
      static_inspection: {
        setup_status: "unknown",
        file_count: 0,
        total_size_bytes: 0,
        unsafe_entry_count: 0,
        useful_static_evidence: false,
        extracted_files: [],
        cleanup_status: "removed",
      },
    };
  }
}

export function buildGitHubArchiveUrl(candidate) {
  const owner = encodeURIComponent(candidate.repo_owner);
  const repo = encodeURIComponent(candidate.repo_name);
  const ref = encodeURIComponent(candidate.default_branch ?? "HEAD");
  return `https://api.github.com/repos/${owner}/${repo}/zipball/${ref}`;
}

export async function fetchCandidateArchiveBuffer({ policy, candidate, fetchImpl = globalThis.fetch }) {
  assertAllowed(policy, "static_source_fetch");
  assertAllowed(policy, "archive_download");
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required for static archive inspection.");
  }
  const url = buildGitHubArchiveUrl(candidate);
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub archive request failed for ${candidate.repo_owner}/${candidate.repo_name} with status ${response.status ?? "unknown"}.`);
  }
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength)) {
    enforceDownloadedArchiveSize(declaredLength, policy);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  enforceDownloadedArchiveSize(buffer.byteLength, policy);
  return buffer;
}

export function parseZipArchiveEntries(archiveBuffer) {
  if (!Buffer.isBuffer(archiveBuffer)) {
    throw new TypeError("Archive must be a Buffer.");
  }
  const eocdOffset = findZipEndOfCentralDirectory(archiveBuffer);
  const totalEntries = archiveBuffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = archiveBuffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = archiveBuffer.readUInt32LE(eocdOffset + 16);
  if (totalEntries === 0xffff || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) {
    throw new Error("ZIP64 archives are not supported by Scout Release 1 static inspection.");
  }
  const entries = [];
  let offset = centralDirectoryOffset;
  const endOffset = centralDirectoryOffset + centralDirectorySize;
  while (offset < endOffset && entries.length < totalEntries) {
    if (archiveBuffer.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("Invalid ZIP central directory entry.");
    }
    const method = archiveBuffer.readUInt16LE(offset + 10);
    const compressedSize = archiveBuffer.readUInt32LE(offset + 20);
    const uncompressedSize = archiveBuffer.readUInt32LE(offset + 24);
    const fileNameLength = archiveBuffer.readUInt16LE(offset + 28);
    const extraLength = archiveBuffer.readUInt16LE(offset + 30);
    const commentLength = archiveBuffer.readUInt16LE(offset + 32);
    const externalAttributes = archiveBuffer.readUInt32LE(offset + 38);
    const localHeaderOffset = archiveBuffer.readUInt32LE(offset + 42);
    const path = archiveBuffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);
    const unixMode = externalAttributes >>> 16;
    const type = path.endsWith("/")
      ? "directory"
      : (unixMode & 0o170000) === 0o120000
        ? "symlink"
        : "file";
    entries.push({
      path,
      size: uncompressedSize,
      compressed_size: compressedSize,
      method,
      type,
      local_header_offset: localHeaderOffset,
    });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

export function evidenceFromStaticInspection(candidate) {
  const inspection = candidate.static_inspection;
  if (!inspection) return [];
  return [
    {
      evidence_id: `evidence-static-${candidate.candidate_id}`,
      candidate_id: candidate.candidate_id,
      source_type: "STATIC_FILE",
      source_ref: `${candidate.repo_owner}/${candidate.repo_name} static inspection`,
      observed_at: new Date().toISOString(),
      trust_level: candidate.static_inspection_status === "static_docs_ok" ? "OBSERVED" : "UNKNOWN",
      claim: `Static inspection status ${candidate.static_inspection_status}: ${inspection.file_count} files, ${inspection.unsafe_entry_count} unsafe entries blocked.`,
      supports: candidate.static_inspection_status === "static_docs_ok" ? "static inspection evidence" : "static inspection uncertainty",
    },
  ];
}

function enforceDownloadedArchiveSize(sizeBytes, policy) {
  const maxArchiveMb = Number(policy?.limits?.static_archive_max_mb);
  const maxBytes = Number.isFinite(maxArchiveMb) ? maxArchiveMb * 1024 * 1024 : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    throw new Error("Downloaded archive size is invalid.");
  }
  if (sizeBytes > maxBytes) {
    const error = new Error(`Downloaded archive size limit exceeded: ${sizeBytes} > ${maxBytes}.`);
    error.code = "SCOUT_STATIC_ARCHIVE_SIZE_LIMIT";
    throw error;
  }
}

function findZipEndOfCentralDirectory(archiveBuffer) {
  const minOffset = Math.max(0, archiveBuffer.length - 65557);
  for (let offset = archiveBuffer.length - 22; offset >= minOffset; offset -= 1) {
    if (archiveBuffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) {
      return offset;
    }
  }
  throw new Error("ZIP end-of-central-directory record not found.");
}

export async function extractSafeZipEntries({ archiveBuffer, zipEntries, validation, outputDir }) {
  const extractedFiles = [];
  for (const safeEntry of validation.safe_entries) {
    const zipEntry = zipEntries[safeEntry.index];
    if (!zipEntry || zipEntry.type !== "file") {
      continue;
    }
    const content = readZipEntryContent(archiveBuffer, zipEntry);
    const relativePath = safeEntry.static_path || safeEntry.normalized_path;
    const outputPath = join(outputDir, relativePath);
    const analysis = analyzeStaticFileContent(relativePath, content);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content);
    extractedFiles.push({
      archive_path: safeEntry.normalized_path,
      static_path: relativePath,
      size_bytes: content.byteLength,
      observations: analysis.observations,
      setup_intelligence: analysis.setup_intelligence,
    });
  }
  return extractedFiles;
}

function readZipEntryContent(archiveBuffer, zipEntry) {
  const offset = zipEntry.local_header_offset;
  if (archiveBuffer.readUInt32LE(offset) !== ZIP_LOCAL_FILE_SIGNATURE) {
    throw new Error(`Invalid ZIP local file header for ${zipEntry.path}.`);
  }
  const fileNameLength = archiveBuffer.readUInt16LE(offset + 26);
  const extraLength = archiveBuffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const dataEnd = dataStart + zipEntry.compressed_size;
  if (dataEnd > archiveBuffer.length) {
    throw new Error(`ZIP entry content exceeds archive bounds for ${zipEntry.path}.`);
  }
  const compressed = archiveBuffer.subarray(dataStart, dataEnd);
  if (zipEntry.method === ZIP_STORED) {
    return compressed;
  }
  if (zipEntry.method === ZIP_DEFLATED) {
    return inflateRawSync(compressed);
  }
  throw new Error(`Unsupported ZIP compression method ${zipEntry.method} for ${zipEntry.path}.`);
}

async function cleanupTempDir(tempDir) {
  await rm(tempDir, { recursive: true, force: true });
  return true;
}

function addArchiveInspectionDetails(candidate, details) {
  const extractedObservations = details.extracted_files.flatMap((file) => file.observations ?? []);
  const setupIntelligence = mergeSetupIntelligence(details.extracted_files.map((file) => file.setup_intelligence));
  const hasStaticRisk = extractedObservations.some((observation) =>
    [
      "risky_lifecycle_script",
      "private_credential_requirement",
      "private_service_requirement",
      "hidden_environment_requirement",
      "prompt_injection_risk",
      "conflicting_package_managers",
    ].includes(observation.kind),
  );
  const requiresPrivateCredentials = extractedObservations.some((observation) =>
    ["private_credential_requirement", "private_service_requirement", "hidden_environment_requirement"].includes(observation.kind)
  );
  const packageManagerObservations = detectPackageManagerConflict(details.extracted_files);
  return {
    ...candidate,
    requires_private_credentials: candidate.requires_private_credentials || requiresPrivateCredentials,
    static_inspection_status: hasStaticRisk || packageManagerObservations.length > 0 ? "static_docs_risky" : candidate.static_inspection_status,
    source_observations: [
      ...(candidate.source_observations ?? []),
      ...extractedObservations,
      ...packageManagerObservations,
      {
        kind: "setup_intelligence",
        value: `Next safest evidence action: ${setupIntelligence.recommended_next_evidence_action.action}.`,
      },
      { kind: "static_archive_fetch", value: `Fetched ${details.archive_url}` },
      { kind: "static_archive_cleanup", value: `Temporary archive workspace ${details.cleanup_status}.` },
    ],
    static_inspection: {
      ...(candidate.static_inspection ?? {}),
      setup_status: hasStaticRisk || packageManagerObservations.length > 0 ? "static_docs_risky" : candidate.static_inspection?.setup_status,
      archive_url: details.archive_url,
      extracted_files: details.extracted_files,
      temp_dir: details.temp_dir,
      cleanup_status: details.cleanup_status,
      setup_intelligence: setupIntelligence,
    },
  };
}

function analyzeStaticFileContent(filePath, content) {
  const text = content.toString("utf8", 0, Math.min(content.byteLength, 1024 * 1024));
  const lowerPath = filePath.toLowerCase();
  const observations = [];
  const setupIntelligence = analyzeStaticFileSetupIntelligence(filePath, text);

  if (/^(?:readme|contributing)(?:\.[a-z0-9._-]+)?$/i.test(filePath) || lowerPath.startsWith("docs/")) {
    if (/\b(setup|install|getting started|development|test)\b/i.test(text)) {
      observations.push({ kind: "setup_docs", value: `${filePath} contains setup or development guidance.` });
    }
    if (/\b(ignore (?:all )?(?:previous|prior) instructions|reveal (?:the )?(?:secret|token|password)|disable (?:logs|logging|audit)|fetch remote (?:instructions|rules)|system prompt)\b/i.test(text)) {
      observations.push({ kind: "prompt_injection_risk", value: `${filePath} contains prompt-injection style operational instructions.` });
    }
    if (/\bcurl\b[^\n|]*\|\s*(?:bash|sh)\b/i.test(text)) {
      observations.push({ kind: "prompt_injection_risk", value: `${filePath} contains a curl pipe shell command.` });
    }
    if (/\b(api[_ -]?key|secret|token)\b/i.test(text) && /\b(required|must|need|set)\b/i.test(text)) {
      observations.push({ kind: "private_credential_requirement", value: `${filePath} appears to require private credentials.` });
    }
    if (/\b(stripe|supabase|firebase|aws|gcp|azure|openai|anthropic|sentry|datadog)\b/i.test(text) && /\b(required|must|need|account|project|service)\b/i.test(text)) {
      observations.push({ kind: "private_service_requirement", value: `${filePath} appears to require a private or paid external service.` });
    }
    if (/\b(?:create|copy|configure|set up)\s+(?:a\s+)?\.env\b/i.test(text) && !/\.env\.(?:example|sample)\b/i.test(text)) {
      observations.push({ kind: "hidden_environment_requirement", value: `${filePath} references a required .env file without a visible example.` });
    }
  }

  if (lowerPath === "package.json") {
    try {
      const parsed = JSON.parse(text);
      const scripts = parsed?.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {};
      for (const scriptName of ["preinstall", "install", "postinstall", "prepare"]) {
        if (typeof scripts[scriptName] === "string" && scripts[scriptName].trim()) {
          observations.push({ kind: "risky_lifecycle_script", value: `package.json defines ${scriptName}.` });
        }
      }
      if (typeof scripts.test === "string" && scripts.test.trim()) {
        observations.push({ kind: "tests_present", value: "package.json defines a test script." });
      }
      if (typeof parsed.packageManager === "string" && parsed.packageManager.trim()) {
        observations.push({ kind: "package_manager_signal", value: `package.json declares ${parsed.packageManager}.` });
      }
    } catch {
      observations.push({ kind: "static_parse_warning", value: "package.json could not be parsed as JSON." });
    }
  }

  if (["package-lock.json", "pnpm-lock.yaml", "yarn.lock"].includes(lowerPath)) {
    observations.push({ kind: "package_manager_signal", value: `${filePath} is present.` });
  }

  if (/^(?:\.env\.(?:example|sample)|[a-z0-9._-]+\/\.env\.(?:example|sample))$/i.test(filePath)) {
    if (/\b(?:secret|token|api[_-]?key|password)\s*=\s*(?:<[^>]+>|your-|changeme|todo|replace|.+)/i.test(text)) {
      observations.push({ kind: "private_credential_requirement", value: `${filePath} includes credential placeholders.` });
    }
  }

  return { observations, setup_intelligence: setupIntelligence };
}

function detectPackageManagerConflict(extractedFiles) {
  const managers = new Map();
  for (const file of extractedFiles) {
    const path = String(file.static_path ?? "").toLowerCase();
    if (path === "package-lock.json") managers.set("npm", "package-lock.json");
    if (path === "pnpm-lock.yaml") managers.set("pnpm", "pnpm-lock.yaml");
    if (path === "yarn.lock") managers.set("yarn", "yarn.lock");
    for (const observation of file.observations ?? []) {
      const packageManager = /^package\.json declares ([^@]+)@?/.exec(observation.value ?? "")?.[1];
      if (packageManager) {
        managers.set(packageManager, observation.value);
      }
    }
  }
  if (managers.size <= 1) {
    return [];
  }
  return [
    {
      kind: "conflicting_package_managers",
      value: `Multiple package manager signals found: ${[...managers.keys()].sort().join(", ")}.`,
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
