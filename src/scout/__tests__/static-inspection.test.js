import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  assertStaticInspectionAllowed,
  evidenceFromStaticInspection,
  inspectCandidateStaticManifest,
  isAllowedStaticFilePath,
  isArchiveAbsolutePath,
  isArchivePathTraversal,
  isSymlinkEscape,
  validateArchiveManifestEntries,
} from "../static-inspection.js";
import { defaultPolicy } from "../policy.js";

const fixtures = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "fixtures", "static-inspection.json"),
    "utf8",
  ),
);

describe("static inspection primitives", () => {
  it("enforces archive inspection policy operations", () => {
    const policy = defaultPolicy("metadata_only");
    assert.throws(() => assertStaticInspectionAllowed(policy), (error) => {
      assert.equal(error.code, "SCOUT_POLICY_DENIED");
      return true;
    });
  });

  it("detects absolute archive paths and traversal paths", () => {
    for (const absolutePath of fixtures.absolutePaths) {
      assert.equal(isArchiveAbsolutePath(absolutePath), true);
    }

    for (const traversalPath of fixtures.traversalPaths) {
      assert.equal(isArchivePathTraversal(traversalPath), true);
    }

    assert.equal(isArchivePathTraversal("docs/guide/setup.md"), false);
  });

  it("detects symlink traversal/escape risk", () => {
    const safeSymlink = {
      path: "safe-docs-link",
      type: "symlink",
      linkTarget: "docs/setup.md",
    };
    const escapingSymlink = {
      path: "bad-docs-link",
      type: "symlink",
      linkTarget: "../outside/secret.txt",
    };
    const missingSymlinkTarget = {
      path: "bad-docs-link-missing",
      type: "2",
    };

    assert.equal(isSymlinkEscape(safeSymlink), false);
    assert.equal(isSymlinkEscape(escapingSymlink), true);
    assert.equal(isSymlinkEscape(missingSymlinkTarget), true);
  });

  it("checks static file allowlist patterns", () => {
    assert.equal(isAllowedStaticFilePath(fixtures.pathAllowlistSamples[0]), true);
    assert.equal(isAllowedStaticFilePath(fixtures.pathAllowlistSamples[1]), true);
    assert.equal(isAllowedStaticFilePath(fixtures.pathAllowlistSamples[2]), false);
    assert.equal(isAllowedStaticFilePath(fixtures.pathAllowlistSamples[3]), true);
    assert.equal(isAllowedStaticFilePath(fixtures.pathAllowlistSamples[4]), true);
  });

  it("builds manifest validation with safe and unsafe entries", () => {
    const policy = defaultPolicy("static_inspection");
    const validation = validateArchiveManifestEntries(
      [...fixtures.safeManifest, ...fixtures.unsafeManifest],
      { policy },
    );

    assert.equal(validation.safe_entries.length, fixtures.safeManifest.length);
    assert.equal(validation.unsafe_entries.length, fixtures.unsafeManifest.length);
    assert.equal(validation.total_size_bytes, 3956);
    assert.equal(validation.file_count, fixtures.safeManifest.length + fixtures.unsafeManifest.length);
  });

  it("rejects file count and archive size limit violations", () => {
    const countPolicy = defaultPolicy("static_inspection");
    countPolicy.limits.static_file_count_max = 1;

    assert.throws(() => validateArchiveManifestEntries(fixtures.safeManifest, { policy: countPolicy }), (error) => {
      assert.equal(error.code, "SCOUT_STATIC_FILE_COUNT_LIMIT");
      return true;
    });

    const sizePolicy = defaultPolicy("static_inspection");
    sizePolicy.limits.static_archive_max_mb = 0.000001;

    assert.throws(() => validateArchiveManifestEntries(fixtures.limitManifest, { policy: sizePolicy }), (error) => {
      assert.equal(error.code, "SCOUT_STATIC_ARCHIVE_SIZE_LIMIT");
      return true;
    });
  });

  it("turns static manifests into candidate observations and evidence", () => {
    const policy = defaultPolicy("static_inspection");
    const candidate = {
      candidate_id: "SCOUT-alpha-green-1",
      repo_owner: "acme",
      repo_name: "tooling",
      source_observations: [],
      collection_status: "OBSERVED",
    };
    const inspected = inspectCandidateStaticManifest({
      policy,
      candidate,
      manifest: [
        ...fixtures.safeManifest,
        { path: "CONTRIBUTING.md", size: 512, type: "file" },
        { path: ".github/workflows/ci.yml", size: 256, type: "file" },
        { path: "pyproject.toml", size: 256, type: "file" },
      ],
    });
    const evidence = evidenceFromStaticInspection(inspected);

    assert.equal(inspected.static_inspection.setup_status, "static_docs_ok");
    assert.ok(inspected.source_observations.some((item) => item.kind === "contributor_guide"));
    assert.ok(inspected.source_observations.some((item) => item.kind === "tests_present"));
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].source_type, "STATIC_FILE");
  });

  it("does not mark missing or empty manifests as static docs ok", () => {
    const policy = defaultPolicy("static_inspection");
    const candidate = {
      candidate_id: "SCOUT-alpha-green-1",
      repo_owner: "acme",
      repo_name: "tooling",
      source_observations: [],
      collection_status: "OBSERVED",
    };

    const missing = inspectCandidateStaticManifest({ policy, candidate, manifest: null });
    const empty = inspectCandidateStaticManifest({ policy, candidate, manifest: [] });

    assert.equal(missing.static_inspection_status, "missing_manifest");
    assert.equal(missing.collection_status, "PARTIAL");
    assert.equal(empty.static_inspection_status, "insufficient_static_evidence");
    assert.equal(empty.collection_status, "PARTIAL");
  });
});
