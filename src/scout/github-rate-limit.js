export function gitHubRateLimitFromHeaders(headers) {
  const limit = readHeaderNumber(headers, "x-ratelimit-limit");
  const remaining = readHeaderNumber(headers, "x-ratelimit-remaining");
  const reset = readHeaderNumber(headers, "x-ratelimit-reset");
  const resource = readHeaderString(headers, "x-ratelimit-resource");
  const used = readHeaderNumber(headers, "x-ratelimit-used");
  if (limit === null && remaining === null && reset === null && resource === null && used === null) {
    return null;
  }
  return {
    limit,
    remaining,
    reset,
    reset_at: reset === null ? null : new Date(reset * 1000).toISOString(),
    resource,
    used,
  };
}

export function gitHubHeaders(headers = {}) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  return {
    Accept: "application/vnd.github+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headers,
  };
}

function readHeaderNumber(headers, name) {
  const value = readHeaderString(headers, name);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readHeaderString(headers, name) {
  const value = headers?.get?.(name);
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}
