import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createSearchProfile,
  loadSearchProfile,
  queriesFromProfile,
  profileAllowsOperation,
  saveSearchProfile,
} from "../profiles.js";
import { validateSearchProfile } from "../validators.js";

const fixtures = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "profiles.json"), "utf8"),
);

describe("search profiles", () => {
  it("derives a normalized profile id and keeps required fields", () => {
    const profile = createSearchProfile(fixtures.createdProfile);
    assert.equal(profile.profile_id, "profile-open-contribution");
    assert.equal(profile.max_candidates, 30);
    assert.equal(profile.mode, "metadata_only");
    assert.equal(profile.languages.length, 1);
  });

  it("builds queries from labels and languages with docs special-case", () => {
    const profile = createSearchProfile({
      name: "Docs First",
      labels: ["documentation"],
      languages: ["Docs"],
      mode: "metadata_only",
    });
    const queries = queriesFromProfile(profile);
    assert.equal(queries.length, 1);
    assert.equal(queries[0], "is:issue state:open label:\"documentation\" no:assignee");
    assert.ok(queries.includes('is:issue state:open label:"documentation" no:assignee language:TypeScript') === false);
  });

  it("allows harmless operations and blocks forbidden ones", () => {
    const profile = validateSearchProfile(fixtures.searchProfile);
    assert.equal(profileAllowsOperation(profile, "github_issue_metadata_read"), true);
    assert.equal(profileAllowsOperation(profile, "git_clone"), false);
    assert.equal(profileAllowsOperation(profile, "package_install"), false);
  });

  it("validates created profiles against schema", () => {
    const profile = createSearchProfile({
      name: "Schema Test",
      mode: "static_inspection",
      labels: ["good first issue"],
      languages: ["Python"],
      max_candidates: 7,
    });
    const validated = validateSearchProfile(profile);
    assert.equal(validated.name, "Schema Test");
    assert.equal(validated.mode, "static_inspection");
  });

  it("persists profiles in local Scout state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scout-profile-"));
    try {
      const profile = createSearchProfile({
        name: "Saved Python",
        labels: ["good first issue"],
        languages: ["Python"],
        max_candidates: 4,
      });
      const saved = await saveSearchProfile(profile, { root: dir });
      const loaded = await loadSearchProfile("Saved Python", { root: dir });

      assert.ok(saved.path.endsWith(join(".scout", "profiles", "saved-python.json")));
      assert.equal(loaded.profile_id, profile.profile_id);
      assert.equal(loaded.max_candidates, 4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
