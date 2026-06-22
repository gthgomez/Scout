export function extractRewardSignals(candidate, issueBody = "") {
  const title = String(candidate.issue_title ?? "");
  const body = String(issueBody ?? "");
  const labels = (candidate.labels ?? []).map((label) => String(label).toLowerCase());
  const combined = `${title}\n${body}`.toLowerCase();
  const signals = [];
  const labelPatterns = [
    { kind: "label", pattern: "bounty", confidence: "OBSERVED" },
    { kind: "label", pattern: "reward", confidence: "OBSERVED" },
    { kind: "label", pattern: "paid", confidence: "OBSERVED" },
    { kind: "label", pattern: "sponsor", confidence: "OBSERVED" },
    { kind: "label", pattern: "algora", confidence: "OBSERVED" },
    { kind: "label", pattern: "gitcoin", confidence: "INFERRED" },
    { kind: "label", pattern: "issuehunt", confidence: "INFERRED" },
    { kind: "label", pattern: "💰", confidence: "OBSERVED" },
  ];

  for (const label of labels) {
    for (const { kind, pattern, confidence } of labelPatterns) {
      if (label.includes(pattern)) {
        signals.push({
          kind,
          value: label,
          confidence,
          source_ref: `label:${label}`,
        });
      }
    }
  }

  const bodyKeywords = ["bounty", "reward", "paid", "sponsor", "algora", "gitcoin", "issuehunt"];
  for (const keyword of bodyKeywords) {
    if (combined.includes(keyword)) {
      signals.push({
        kind: "keyword",
        value: keyword,
        confidence: title.toLowerCase().includes(keyword) ? "OBSERVED" : "INFERRED",
        source_ref: title.toLowerCase().includes(keyword) ? "issue_title" : "issue_body",
      });
    }
  }

  const amountPatterns = [
    /\$\s*(\d{1,6}(?:,\d{3})*(?:\.\d{2})?)/gi,
    /(\d{1,6}(?:,\d{3})*(?:\.\d{2})?)\s*(?:usd|usdc|usdt)\b/gi,
  ];
  let estimatedRewardUsd = null;
  for (const pattern of amountPatterns) {
    let match = pattern.exec(title);
    let sourceRef = "issue_title";
    if (!match) {
      pattern.lastIndex = 0;
      match = pattern.exec(body);
      sourceRef = "issue_body";
    }
    if (match) {
      const parsed = Number(String(match[1]).replaceAll(",", ""));
      if (Number.isFinite(parsed) && parsed > 0) {
        estimatedRewardUsd = parsed;
        signals.push({
          kind: "amount",
          value: `$${parsed}`,
          confidence: sourceRef === "issue_title" ? "OBSERVED" : "INFERRED",
          source_ref: sourceRef,
        });
        break;
      }
    }
    pattern.lastIndex = 0;
  }

  const deduped = dedupeRewardSignals(signals);
  const hasVerified = deduped.some((signal) => signal.confidence === "OBSERVED" && ["label", "amount"].includes(signal.kind));
  const hasInferred = deduped.some((signal) => signal.confidence === "INFERRED" || signal.kind === "keyword");

  return {
    reward_signals: deduped,
    has_verified_reward_signal: hasVerified,
    has_observed_reward_metadata: hasVerified,
    has_inferred_reward_signal: hasInferred,
    estimated_reward_usd: estimatedRewardUsd,
    source_observations: deduped.map((signal) => ({
      kind: "reward_signal",
      value: `${signal.kind}:${signal.value}`,
      confidence: signal.confidence,
      source_ref: signal.source_ref,
    })),
  };
}

function dedupeRewardSignals(signals) {
  const seen = new Set();
  return signals.filter((signal) => {
    const key = `${signal.kind}:${signal.value}:${signal.source_ref}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function applyRepositoryMetadata(candidate, repository) {
  return {
    ...candidate,
    archived: repository.archived ?? candidate.archived,
    default_branch: repository.default_branch ?? repository.defaultBranchRef?.name ?? candidate.default_branch,
    primary_language: repository.language ?? repository.primaryLanguage?.name ?? candidate.primary_language,
    license_spdx: repository.license?.spdx_id ?? repository.licenseInfo?.spdxId ?? candidate.license_spdx,
    latest_repo_activity_at:
      repository.pushed_at ?? repository.updated_at ?? repository.pushedAt ?? repository.updatedAt ?? candidate.latest_repo_activity_at,
    collection_status: candidate.collection_status === "FAILED" ? "PARTIAL" : "OBSERVED",
  };
}

export function applyIssueMetadata(candidate, issue) {
  const linkedPrs = issue.linked_prs ?? issue.timelineItems?.nodes?.filter((node) => node.pullRequest).map((node) => node.pullRequest) ?? [];
  const maintainerComment = latestMaintainerComment(issue.comments?.nodes ?? issue.comments ?? []);
  return {
    ...candidate,
    latest_maintainer_activity_at: maintainerComment?.updatedAt ?? maintainerComment?.updated_at ?? candidate.latest_maintainer_activity_at,
    linked_prs: linkedPrs.map(normalizeLinkedPr),
    claimed_in_comments: issueAppearsClaimed(issue.comments?.nodes ?? issue.comments ?? []),
    collection_status: candidate.collection_status === "FAILED" ? "PARTIAL" : "OBSERVED",
  };
}

function latestMaintainerComment(comments) {
  return comments
    .filter((comment) => ["OWNER", "MEMBER", "COLLABORATOR"].includes(authorAssociationOf(comment)))
    .sort((a, b) => new Date(b.updatedAt ?? b.updated_at ?? 0) - new Date(a.updatedAt ?? a.updated_at ?? 0))[0];
}

function authorAssociationOf(comment) {
  return comment.authorAssociation ?? comment.author_association;
}

function normalizeLinkedPr(pr) {
  const title = pr.title ?? "";
  const state = pr.state ?? "unknown";
  const merged = Boolean(pr.merged ?? pr.mergedAt);
  return {
    url: pr.url ?? pr.html_url ?? "",
    title,
    state,
    merged,
    likely_solves_issue: merged || /\b(fix|fixes|fixed|close|closes|closed|resolve|resolves|resolved)\b/i.test(title),
  };
}

function issueAppearsClaimed(comments) {
  return comments.some((comment) => {
    const body = String(comment.body ?? "");
    return /\b(i'?ll take|i am working|i'm working|assigned to me|can i work|working on this)\b/i.test(body);
  });
}

export function linkedPrsFromTimeline(timelineItems) {
  if (!Array.isArray(timelineItems)) return [];
  return timelineItems
    .map((item) => item.source?.issue ?? item)
    .filter((item) => item?.pull_request)
    .map((item) => ({
      title: item.title,
      state: item.state,
      url: item.html_url ?? item.pull_request?.html_url,
      merged: Boolean(item.pull_request?.merged_at),
    }));
}
