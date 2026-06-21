import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyIssueMetadata,
  applyRepositoryMetadata,
  dedupeCandidates,
  discoverCandidates,
  fromGitHubSearchItem,
} from "../discovery.js";
import { AuditLog } from "../audit-log.js";
import { defaultPolicy } from "../policy.js";

describe("discovery mapping", () => {
  it("maps GitHub search items into partial candidates", () => {
    const candidate = fromGitHubSearchItem(
      {
        repository_url: "https://api.github.com/repos/acme/tooling",
        number: 42,
        title: "Fix docs typo",
        html_url: "https://github.com/acme/tooling/issues/42",
        labels: [{ name: "good first issue" }],
        state: "open",
        assignees: [],
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-02T00:00:00Z",
      },
      "query",
    );

    assert.equal(candidate.repo_owner, "acme");
    assert.equal(candidate.repo_name, "tooling");
    assert.equal(candidate.issue_number, 42);
    assert.deepEqual(candidate.labels, ["good first issue"]);
    assert.equal(candidate.collection_status, "PARTIAL");
    assert.equal(candidate.static_inspection_status, "not_requested");
  });

  it("dedupes by repo and issue number", () => {
    const candidates = [
      { repo_owner: "a", repo_name: "b", issue_number: 1, candidate_id: "first" },
      { repo_owner: "a", repo_name: "b", issue_number: 1, candidate_id: "second" },
    ];
    assert.deepEqual(dedupeCandidates(candidates).map((candidate) => candidate.candidate_id), ["first"]);
  });

  it("applies repository metadata from REST or GraphQL shapes", () => {
    const candidate = applyRepositoryMetadata(
      { candidate_id: "c", collection_status: "PARTIAL", latest_repo_activity_at: null },
      {
        archived: false,
        defaultBranchRef: { name: "main" },
        primaryLanguage: { name: "TypeScript" },
        licenseInfo: { spdxId: "MIT" },
        pushedAt: "2026-06-01T00:00:00Z",
      },
    );

    assert.equal(candidate.default_branch, "main");
    assert.equal(candidate.primary_language, "TypeScript");
    assert.equal(candidate.license_spdx, "MIT");
    assert.equal(candidate.latest_repo_activity_at, "2026-06-01T00:00:00Z");
    assert.equal(candidate.collection_status, "OBSERVED");
  });

  it("applies issue metadata for maintainer comments, claim signals, and linked PRs", () => {
    const candidate = applyIssueMetadata(
      { candidate_id: "c", collection_status: "PARTIAL", linked_prs: [] },
      {
        comments: {
          nodes: [
            {
              authorAssociation: "CONTRIBUTOR",
              body: "I'm working on this",
              updatedAt: "2026-06-01T00:00:00Z",
            },
            {
              authorAssociation: "MEMBER",
              body: "Thanks",
              updatedAt: "2026-06-02T00:00:00Z",
            },
          ],
        },
        linked_prs: [{ title: "fix docs typo", merged: false, url: "https://github.com/acme/tooling/pull/5" }],
      },
    );

    assert.equal(candidate.claimed_in_comments, true);
    assert.equal(candidate.latest_maintainer_activity_at, "2026-06-02T00:00:00Z");
    assert.equal(candidate.linked_prs[0].likely_solves_issue, true);
    assert.equal(candidate.collection_status, "OBSERVED");
  });

  it("recognizes REST maintainer author association fields", () => {
    const candidate = applyIssueMetadata(
      { candidate_id: "c", collection_status: "PARTIAL", linked_prs: [] },
      {
        comments: [
          {
            author_association: "MEMBER",
            body: "Thanks for reporting.",
            updated_at: "2026-06-04T00:00:00Z",
          },
        ],
      },
    );

    assert.equal(candidate.latest_maintainer_activity_at, "2026-06-04T00:00:00Z");
    assert.equal(candidate.collection_status, "OBSERVED");
  });

  it("discovers and enriches candidate metadata through allowed GitHub reads", async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      if (String(url).includes("/search/issues")) {
        return okJson(
          {
            items: [
              {
                repository_url: "https://api.github.com/repos/acme/tooling",
                number: 42,
                title: "Fix docs typo",
                html_url: "https://github.com/acme/tooling/issues/42",
                labels: [{ name: "good first issue" }],
                state: "open",
                assignees: [],
                created_at: "2026-06-01T00:00:00Z",
                updated_at: "2026-06-02T00:00:00Z",
                comments_url: "https://api.github.com/repos/acme/tooling/issues/42/comments",
              },
            ],
          },
          { "x-ratelimit-limit": "100", "x-ratelimit-remaining": "98", "x-ratelimit-reset": "1780000000", "x-ratelimit-resource": "search" },
        );
      }
      if (String(url).endsWith("/repos/acme/tooling")) {
        return okJson(
          {
            archived: false,
            default_branch: "main",
            language: "TypeScript",
            license: { spdx_id: "MIT" },
            pushed_at: "2026-06-03T00:00:00Z",
          },
          { "x-ratelimit-limit": "5000", "x-ratelimit-remaining": "4999", "x-ratelimit-reset": "1780000000", "x-ratelimit-resource": "core" },
        );
      }
      if (String(url).endsWith("/issues/42")) {
        return okJson(
          {
            comments_url: "https://api.github.com/repos/acme/tooling/issues/42/comments",
          },
          { "x-ratelimit-limit": "5000", "x-ratelimit-remaining": "4998", "x-ratelimit-reset": "1780000000", "x-ratelimit-resource": "core" },
        );
      }
      if (String(url).endsWith("/issues/42/comments")) {
        return okJson([
          {
            authorAssociation: "MEMBER",
            body: "Thanks for reporting",
            updated_at: "2026-06-04T00:00:00Z",
          },
        ]);
      }
      if (String(url).endsWith("/issues/42/timeline")) {
        return okJson([]);
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const auditLog = new AuditLog();
    const candidates = await discoverCandidates({
      policy: defaultPolicy("metadata_only"),
      queries: ["query"],
      limit: 1,
      fetchImpl,
      auditLog,
    });

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].collection_status, "OBSERVED");
    assert.equal(candidates[0].primary_language, "TypeScript");
    assert.equal(candidates[0].latest_maintainer_activity_at, "2026-06-04T00:00:00Z");
    assert.ok(candidates[0].source_observations.some((item) => item.kind === "github_rate_limit"));
    assert.ok(calls.some((url) => url.endsWith("/repos/acme/tooling")));
    assert.ok(auditLog.all().some((event) => event.operation === "github_repo_metadata_read"));
    assert.ok(auditLog.all().some((event) => event.decision === "observed" && event.reason.includes("4999/5000")));
  });

  it("uses a GitHub token from the environment when one is present", async () => {
    const previousToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "test-token";
    const seenHeaders = [];
    try {
      await discoverCandidates({
        policy: defaultPolicy("metadata_only"),
        queries: ["query"],
        limit: 1,
        enrich: false,
        fetchImpl: async (_url, init = {}) => {
          seenHeaders.push(init.headers);
          return okJson({ items: [] });
        },
      });
    } finally {
      if (previousToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = previousToken;
      }
    }

    assert.equal(seenHeaders[0].Authorization, "Bearer test-token");
    assert.equal(seenHeaders[0].Accept, "application/vnd.github+json");
  });

  it("retains partial candidates when enrichment metadata fails", async () => {
    const fetchImpl = async (url) => {
      if (String(url).includes("/search/issues")) {
        return okJson({
          items: [
            {
              repository_url: "https://api.github.com/repos/acme/tooling",
              number: 42,
              title: "Fix docs typo",
              html_url: "https://github.com/acme/tooling/issues/42",
              labels: [],
              state: "open",
              assignees: [],
              updated_at: "2026-06-02T00:00:00Z",
            },
          ],
        });
      }
      return { ok: false, status: 500, json: async () => ({}) };
    };

    const candidates = await discoverCandidates({
      policy: defaultPolicy("metadata_only"),
      queries: ["query"],
      limit: 1,
      fetchImpl,
    });

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].collection_status, "PARTIAL");
    assert.ok(candidates[0].source_observations.some((item) => item.kind === "metadata_error"));
  });

  it("records GitHub search failures as collection errors", async () => {
    const collectionErrors = [];
    const candidates = await discoverCandidates({
      policy: defaultPolicy("metadata_only"),
      queries: ["query"],
      limit: 1,
      fetchImpl: async () => ({
        ok: false,
        status: 403,
        headers: { get: (name) => ({ "x-ratelimit-limit": "100", "x-ratelimit-remaining": "0" })[name.toLowerCase()] ?? null },
        json: async () => ({}),
      }),
      collectionErrors,
    });

    assert.equal(candidates.length, 0);
    assert.equal(collectionErrors.length, 1);
    assert.equal(collectionErrors[0].operation, "github_search_read");
    assert.equal(collectionErrors[0].rate_limit.remaining, 0);
    assert.match(collectionErrors[0].message, /403/);
  });

  it("applies saved profile repo and org exclusions before enrichment", async () => {
    const fetchImpl = async (url) => {
      if (String(url).includes("/search/issues")) {
        return okJson({
          items: [
            {
              repository_url: "https://api.github.com/repos/acme/tooling",
              number: 42,
              title: "Fix docs typo",
              html_url: "https://github.com/acme/tooling/issues/42",
              labels: [],
              state: "open",
              assignees: [],
              updated_at: "2026-06-02T00:00:00Z",
            },
          ],
        });
      }
      throw new Error("excluded candidates should not be enriched");
    };

    const candidates = await discoverCandidates({
      policy: defaultPolicy("metadata_only"),
      queries: ["query"],
      limit: 1,
      fetchImpl,
      profile: { exclude_orgs: ["acme"], exclude_repos: [] },
    });

    assert.equal(candidates.length, 0);
  });

  it("keeps trusted seed-list provenance on descriptor queries", async () => {
    const candidates = await discoverCandidates({
      policy: defaultPolicy("metadata_only"),
      queries: [
        {
          query: 'repo:acme/tooling is:issue state:open label:"good first issue" no:assignee language:Python',
          kind: "trusted_seed_list",
          seed_list_id: "starter-pack",
          repo: "acme/tooling",
        },
      ],
      limit: 1,
      enrich: false,
      fetchImpl: async () =>
        okJson({
          items: [
            {
              repository_url: "https://api.github.com/repos/acme/tooling",
              number: 42,
              title: "Fix docs typo",
              html_url: "https://github.com/acme/tooling/issues/42",
              labels: [{ name: "good first issue" }],
              state: "open",
              assignees: [],
              updated_at: "2026-06-02T00:00:00Z",
            },
          ],
        }),
    });

    assert.equal(candidates[0].discovered_by_query, 'repo:acme/tooling is:issue state:open label:"good first issue" no:assignee language:Python');
    assert.deepEqual(candidates[0].source_observations[0], {
      kind: "trusted_seed_list",
      value: "starter-pack",
      repo: "acme/tooling",
    });
  });

  it("lets profile excludes override trusted seed-list inclusion", async () => {
    const candidates = await discoverCandidates({
      policy: defaultPolicy("metadata_only"),
      queries: [
        {
          query: 'repo:acme/tooling is:issue state:open label:"good first issue" no:assignee language:Python',
          kind: "trusted_seed_list",
          seed_list_id: "starter-pack",
          repo: "acme/tooling",
        },
      ],
      limit: 1,
      profile: { exclude_orgs: [], exclude_repos: ["acme/tooling"] },
      fetchImpl: async (url) => {
        if (String(url).includes("/search/issues")) {
          return okJson({
            items: [
              {
                repository_url: "https://api.github.com/repos/acme/tooling",
                number: 42,
                title: "Fix docs typo",
                html_url: "https://github.com/acme/tooling/issues/42",
                labels: [{ name: "good first issue" }],
                state: "open",
                assignees: [],
                updated_at: "2026-06-02T00:00:00Z",
              },
            ],
          });
        }
        throw new Error("excluded seed candidates should not be enriched");
      },
    });

    assert.equal(candidates.length, 0);
  });
});

function okJson(body, headers = {}) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}
