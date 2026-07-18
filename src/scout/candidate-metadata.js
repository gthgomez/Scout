export { extractRewardSignals } from "./reward-signals.js";

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

function commentListFromIssue(issue) {
  if (Array.isArray(issue.comments)) {
    return issue.comments;
  }
  return issue.comments?.nodes ?? [];
}

function latestCommentAt(comments) {
  let latest = null;
  for (const comment of comments) {
    const at = comment.updatedAt ?? comment.updated_at ?? comment.created_at ?? comment.createdAt;
    if (!at) {
      continue;
    }
    if (!latest || new Date(at) > new Date(latest)) {
      latest = at;
    }
  }
  return latest;
}

export function applyIssueMetadata(candidate, issue) {
  const comments = commentListFromIssue(issue);
  const linkedPrs = issue.linked_prs ?? issue.timelineItems?.nodes?.filter((node) => node.pullRequest).map((node) => node.pullRequest) ?? [];
  const normalizedLinkedPrs = linkedPrs.map(normalizeLinkedPr);
  const maintainerComment = latestMaintainerComment(comments);
  const commentCount =
    typeof issue.comments_count === "number"
      ? issue.comments_count
      : typeof issue.comments === "number"
        ? issue.comments
        : comments.length;
  return {
    ...candidate,
    comment_count: commentCount,
    last_comment_at: latestCommentAt(comments) ?? candidate.last_comment_at ?? null,
    latest_maintainer_activity_at: maintainerComment?.updatedAt ?? maintainerComment?.updated_at ?? candidate.latest_maintainer_activity_at,
    linked_prs: normalizedLinkedPrs,
    has_open_linked_pr: normalizedLinkedPrs.some(
      (pr) => !pr.merged && String(pr.state ?? "").toLowerCase() === "open",
    ),
    has_attempt_comment: comments.some((comment) => /\/attempt\b/i.test(String(comment.body ?? ""))),
    claimed_in_comments: issueAppearsClaimed(comments),
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
