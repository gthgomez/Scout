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
  appendRepoSizeFilter,
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

  it("builds include queries, seed-list queries, then broad generated queries", () => {
    const profile = validateSearchProfile({
      ...fixtures.searchProfile,
      include_queries: ["is:issue state:open sort:updated-desc"],
      labels: ["good first issue"],
      languages: ["Python"],
      trusted_seed_lists: ["starter-pack"],
    });
    const queries = queriesFromProfile(profile, {
      trustedSeedLists: [
        {
          seed_list_id: "starter-pack",
          name: "Starter Pack",
          repos: [
            {
              repo: "pallets/flask",
              labels: ["good first issue"],
              languages: ["Python"],
            },
            {
              repo: "nodejs/node",
              labels: [],
            },
          ],
        },
      ],
    });

    assert.equal(queries[0], "is:issue state:open sort:updated-desc");
    assert.deepEqual(queries[1], {
      query: 'repo:pallets/flask is:issue state:open label:"good first issue" no:assignee language:Python',
      kind: "trusted_seed_list",
      seed_list_id: "starter-pack",
      seed_list_name: "Starter Pack",
      repo: "pallets/flask",
    });
    assert.equal(queries[2].query, "repo:nodejs/node is:issue state:open no:assignee");
    assert.equal(queries[3], 'is:issue state:open label:"good first issue" no:assignee language:Python');
  });

  it("dedupes profile query text while preserving the first occurrence", () => {
    const duplicatedSeedQuery = 'repo:pallets/flask is:issue state:open label:"good first issue" no:assignee language:Python';
    const profile = validateSearchProfile({
      ...fixtures.searchProfile,
      include_queries: [duplicatedSeedQuery],
      labels: ["good first issue"],
      languages: ["Python"],
      trusted_seed_lists: ["starter-pack"],
    });

    const queries = queriesFromProfile(profile, {
      trustedSeedLists: [
        {
          seed_list_id: "starter-pack",
          name: "Starter Pack",
          repos: [{ repo: "pallets/flask", labels: ["good first issue"], languages: ["Python"] }],
        },
      ],
    });

    assert.equal(queries.filter((query) => (typeof query === "string" ? query : query.query) === duplicatedSeedQuery).length, 1);
    assert.equal(queries[0], duplicatedSeedQuery);
  });

  it("applies repo_size_filter to trusted seed list and broad profile queries", () => {
    const profile = validateSearchProfile({
      ...fixtures.searchProfile,
      repo_size_filter: "stars:<500",
      labels: ["good first issue"],
      languages: ["Python"],
      trusted_seed_lists: ["starter-pack"],
    });
    const queries = queriesFromProfile(profile, {
      trustedSeedLists: [
        {
          seed_list_id: "starter-pack",
          name: "Starter Pack",
          repos: [{ repo: "n8n-io/n8n", labels: ["good first issue"], languages: ["Python"] }],
        },
      ],
    });

    const seedQuery = queries.find((query) => typeof query === "object" && query.repo === "n8n-io/n8n");
    assert.ok(seedQuery.query.includes("stars:<500"));
    assert.ok(
      queries.some(
        (query) =>
          typeof query === "string" &&
          query.includes('label:"good first issue"') &&
          query.includes("stars:<500"),
      ),
    );
    assert.equal(appendRepoSizeFilter("repo:foo/bar is:issue state:open", profile).includes("stars:<500"), true);
    assert.equal(appendRepoSizeFilter("repo:foo/bar stars:<500", profile), "repo:foo/bar stars:<500");
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
