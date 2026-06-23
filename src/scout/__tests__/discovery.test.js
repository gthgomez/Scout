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
    const prevRetries = process.env.SCOUT_SEARCH_MAX_RETRIES;
    process.env.SCOUT_SEARCH_MAX_RETRIES = "0";
    try {
      const candidates = await discoverCandidates({
        policy: defaultPolicy("metadata_only"),
        queries: ["query"],
        limit: 1,
        fetchImpl: async () => ({
          ok: false,
          status: 403,
          headers: { get: (name) => ({
            "x-ratelimit-limit": "100",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-resource": "search",
          })[name.toLowerCase()] ?? null },
          text: async () => "API rate limit exceeded",
          json: async () => ({}),
        }),
        collectionErrors,
      });

      assert.equal(candidates.length, 0);
      assert.equal(collectionErrors.length, 1);
      assert.equal(collectionErrors[0].operation, "github_search_read");
      assert.equal(collectionErrors[0].rate_limit.remaining, 0);
      assert.equal(collectionErrors[0].error_kind, "primary_rate_limit");
      assert.match(collectionErrors[0].message, /403/);
    } finally {
      if (prevRetries === undefined) delete process.env.SCOUT_SEARCH_MAX_RETRIES;
      else process.env.SCOUT_SEARCH_MAX_RETRIES = prevRetries;
    }
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

describe("discovery query budgeting", () => {
  it("caps items taken from each query when max_issues_per_query is set", async () => {
    const seedQuery = "repo:appwrite/appwrite is:issue state:open no:assignee";
    const broadQuery = "is:issue state:open label:bounty no:assignee";
    const searchCalls = [];
    const githubClient = {
      searchIssues: async (query) => {
        searchCalls.push(query);
        const count = query === seedQuery ? 20 : 15;
        return {
          body: {
            items: Array.from({ length: count }, (_, index) => searchItem(`acme/${query === seedQuery ? "seed" : "broad"}`, index + 1, query)),
          },
          rate_limit: null,
        };
      },
      enrichCandidates: async (items) => items,
    };

    const candidates = await discoverCandidates({
      policy: defaultPolicy("metadata_only"),
      queries: [seedQuery, broadQuery],
      limit: 50,
      enrich: false,
      profile: { max_issues_per_query: 5 },
      githubClient,
    });

    assert.equal(candidates.length, 10);
    assert.equal(candidates.filter((candidate) => candidate.discovered_by_query === seedQuery).length, 5);
    assert.equal(candidates.filter((candidate) => candidate.discovered_by_query === broadQuery).length, 5);
    assert.deepEqual(searchCalls, [seedQuery, broadQuery]);
  });

  it("interleaves one item per query per pass when interleave_discovery_queries is true", async () => {
    const firstQuery = "query-a";
    const secondQuery = "query-b";
    const githubClient = {
      searchIssues: async (query) => ({
        body: {
          items:
            query === firstQuery
              ? [
                  searchItem("acme/first", 1, query, "item-query-a-1"),
                  searchItem("acme/first", 2, query, "item-query-a-2"),
                  searchItem("acme/first", 3, query, "item-query-a-3"),
                ]
              : [
                  searchItem("acme/second", 1, query, "item-query-b-1"),
                  searchItem("acme/second", 2, query, "item-query-b-2"),
                  searchItem("acme/second", 3, query, "item-query-b-3"),
                ],
        },
        rate_limit: null,
      }),
      enrichCandidates: async (items) => items,
    };

    const candidates = await discoverCandidates({
      policy: defaultPolicy("metadata_only"),
      queries: [firstQuery, secondQuery],
      limit: 4,
      enrich: false,
      profile: { interleave_discovery_queries: true },
      githubClient,
    });

    assert.deepEqual(
      candidates.map((candidate) => candidate.issue_title),
      ["item-query-a-1", "item-query-b-1", "item-query-a-2", "item-query-b-2"],
    );
  });

  it("reserves broad-query slots so include_queries still run when seeds would fill the limit", async () => {
    const seedQuery = {
      query: "repo:appwrite/appwrite is:issue state:open no:assignee",
      kind: "trusted_seed_list",
      seed_list_id: "rewarded-programs",
      repo: "appwrite/appwrite",
    };
    const broadQuery = "is:issue state:open label:algora no:assignee";
    const searchCalls = [];
    const githubClient = {
      searchIssues: async (query) => {
        searchCalls.push(query);
        const repo = query === seedQuery.query ? "appwrite/appwrite" : "broad/repo";
        const count = query === seedQuery.query ? 50 : 5;
        return {
          body: {
            items: Array.from({ length: count }, (_, index) => searchItem(repo, index + 1, query)),
          },
          rate_limit: null,
        };
      },
      enrichCandidates: async (items) => items,
    };

    const candidates = await discoverCandidates({
      policy: defaultPolicy("metadata_only"),
      queries: [seedQuery, broadQuery],
      limit: 10,
      enrich: false,
      profile: {
        reserve_broad_query_slots: 3,
      },
      githubClient,
    });

    assert.equal(candidates.length, 10);
    assert.equal(candidates.filter((candidate) => candidate.discovered_by_query === broadQuery).length, 3);
    assert.equal(candidates.filter((candidate) => candidate.discovered_by_query === seedQuery.query).length, 7);
    assert.ok(searchCalls.includes(broadQuery));
  });

  it("interleaves seed and broad API calls when reserve_broad_query_slots is set", async () => {
    const seedQueries = Array.from({ length: 6 }, (_, index) => ({
      query: `repo:seed/repo-${index} is:issue state:open no:assignee`,
      kind: "trusted_seed_list",
      seed_list_id: "rewarded-programs",
      repo: `seed/repo-${index}`,
    }));
    const broadQueries = [
      "is:issue state:open label:algora no:assignee",
      "is:issue state:open label:bounty no:assignee",
      "is:issue state:open label:issuehunt no:assignee",
      "is:issue state:open label:reward no:assignee",
    ];
    const searchCalls = [];
    const githubClient = {
      searchIssues: async (query) => {
        searchCalls.push(query);
        return { body: { items: [] }, rate_limit: null };
      },
      enrichCandidates: async (items) => items,
    };

    await discoverCandidates({
      policy: defaultPolicy("metadata_only"),
      queries: [...seedQueries, ...broadQueries],
      limit: 10,
      enrich: false,
      profile: {
        reserve_broad_query_slots: 3,
      },
      githubClient,
    });

    const firstBroadIndex = searchCalls.findIndex((query) => broadQueries.includes(query));
    assert.ok(firstBroadIndex >= 0);
    assert.ok(firstBroadIndex < seedQueries.length, "broad search should start before all seed searches finish");
    assert.equal(
      searchCalls.filter((query) => broadQueries.includes(query)).length,
      broadQueries.length,
    );
  });

  it("searches at least three broad queries when seeds return no candidates", async () => {
    const seedQueries = Array.from({ length: 4 }, (_, index) => ({
      query: `repo:seed/repo-${index} is:issue state:open no:assignee`,
      kind: "trusted_seed_list",
      seed_list_id: "rewarded-programs",
      repo: `seed/repo-${index}`,
    }));
    const broadQueries = [
      "is:issue state:open label:algora no:assignee",
      "is:issue state:open label:bounty no:assignee",
      "is:issue state:open label:issuehunt no:assignee",
      "is:issue state:open label:reward no:assignee",
    ];
    const searchCalls = [];
    const githubClient = {
      searchIssues: async (query) => {
        searchCalls.push(query);
        const broadIndex = broadQueries.indexOf(query);
        const isBroad = broadIndex >= 0;
        const count = isBroad ? 2 : 0;
        const repo = isBroad ? `broad/repo-${broadIndex}` : "seed/empty";
        return {
          body: {
            items: Array.from({ length: count }, (_, index) => searchItem(repo, index + 1, query)),
          },
          rate_limit: null,
        };
      },
      enrichCandidates: async (items) => items,
    };

    const candidates = await discoverCandidates({
      policy: defaultPolicy("metadata_only"),
      queries: [...seedQueries, ...broadQueries],
      limit: 10,
      enrich: false,
      profile: {
        reserve_broad_query_slots: 5,
        max_issues_per_query: 5,
        interleave_discovery_queries: true,
      },
      githubClient,
    });

    assert.equal(searchCalls.filter((query) => broadQueries.includes(query)).length, broadQueries.length);
    assert.ok(candidates.length >= 3);
    assert.ok(
      broadQueries.filter((query) => candidates.some((candidate) => candidate.discovered_by_query === query)).length >= 3,
    );
  });
});

function searchItem(repo, number, discoveredByQuery, title = `Issue ${number}`) {
  const [repoOwner, repoName] = repo.split("/");
  return {
    repository_url: `https://api.github.com/repos/${repoOwner}/${repoName}`,
    number,
    title,
    html_url: `https://github.com/${repoOwner}/${repoName}/issues/${number}`,
    labels: [],
    state: "open",
    assignees: [],
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-02T00:00:00Z",
    discovered_by_query: discoveredByQuery,
  };
}

function okJson(body, headers = {}) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}
