import {
  applyIssueMetadata,
  applyRepositoryMetadata,
  extractRewardSignals,
} from "./candidate-metadata.js";

const CHUNK_SIZE = 10;

function buildChunkQuery(candidates) {
  const lines = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const owner = candidate.repo_owner.replace(/"/g, "");
    const name = candidate.repo_name.replace(/"/g, "");
    const num = candidate.issue_number;
    lines.push(`
      r${i}: repository(owner: "${owner}", name: "${name}") {
        nameWithOwner
        isArchived
        defaultBranchRef { name }
        primaryLanguage { name }
        licenseInfo { spdxId }
        pushedAt
        updatedAt
        issue(number: ${num}) {
          title
          body
          state
          updatedAt
          labels(first: 20) { nodes { name } }
          comments(first: 10) {
            nodes {
              body
              updatedAt
              authorAssociation
            }
          }
          timelineItems(first: 20, itemTypes: [CROSS_REFERENCED_EVENT, CONNECTED_EVENT]) {
            nodes {
              ... on CrossReferencedEvent {
                source {
                  ... on PullRequest {
                    title
                    state
                    url
                    merged
                  }
                }
              }
            }
          }
        }
      }
    `);
  }
  return `query ScoutEnrichChunk { ${lines.join("\n")} }`;
}

function linkedPrsFromGraphqlTimeline(timelineItems) {
  const nodes = timelineItems?.nodes ?? [];
  return nodes
    .map((node) => node?.source)
    .filter((pr) => pr?.url)
    .map((pr) => ({
      title: pr.title,
      state: pr.state,
      url: pr.url,
      merged: Boolean(pr.merged),
    }));
}

function enrichFromGraphqlRepo(candidate, repoNode) {
  if (!repoNode) {
    return null;
  }

  let enriched = applyRepositoryMetadata(candidate, {
    archived: repoNode.isArchived,
    defaultBranchRef: repoNode.defaultBranchRef,
    primaryLanguage: repoNode.primaryLanguage,
    licenseInfo: repoNode.licenseInfo,
    pushedAt: repoNode.pushedAt,
    updatedAt: repoNode.updatedAt,
  });

  const issueNode = repoNode.issue;
  if (!issueNode) {
    return enriched;
  }

  const linkedPrs = linkedPrsFromGraphqlTimeline(issueNode.timelineItems);
  enriched = applyIssueMetadata(enriched, {
    comments: { nodes: issueNode.comments?.nodes ?? [] },
    linked_prs: linkedPrs,
  });

  const labels = (issueNode.labels?.nodes ?? []).map((label) => label.name);
  if (labels.length > 0) {
    enriched = { ...enriched, labels };
  }

  const rewardFields = extractRewardSignals(enriched, issueNode.body ?? "");
  return {
    ...enriched,
    ...rewardFields,
    source_observations: [
      ...(enriched.source_observations ?? []),
      { kind: "graphql_enrich", value: "batch", confidence: "OBSERVED" },
      ...rewardFields.source_observations,
    ],
  };
}

async function enrichChunk(candidates, { graphqlRequest, enrichOne }) {
  const query = buildChunkQuery(candidates);
  const response = await graphqlRequest(query, {});

  if (response.body?.errors?.length) {
    throw new Error(response.body.errors.map((error) => error.message).join("; "));
  }

  const data = response.body?.data ?? {};
  const enriched = [];

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const repoNode = data[`r${i}`];
    try {
      const result = enrichFromGraphqlRepo(candidate, repoNode);
      if (result) {
        enriched.push(result);
      } else {
        enriched.push(await enrichOne(candidate));
      }
    } catch {
      enriched.push(await enrichOne(candidate));
    }
  }

  return enriched;
}

export async function enrichCandidatesGraphql(candidates, { graphqlRequest, enrichOne }) {
  const results = [];
  for (let i = 0; i < candidates.length; i += CHUNK_SIZE) {
    const chunk = candidates.slice(i, i + CHUNK_SIZE);
    try {
      const chunkResults = await enrichChunk(chunk, { graphqlRequest, enrichOne });
      results.push(...chunkResults);
    } catch {
      for (const candidate of chunk) {
        const fallback = await enrichOne(candidate);
        if (!fallback.source_observations?.some((item) => item.kind === "graphql_fallback")) {
          fallback.source_observations = [
            ...(fallback.source_observations ?? []),
            { kind: "graphql_fallback", value: "chunk_error", confidence: "INFERRED" },
          ];
        }
        results.push(fallback);
      }
    }
  }
  return results;
}
