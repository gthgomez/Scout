import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SEED_LIST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const REPO_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/;

export function seedListStoreDir(root = process.cwd()) {
  return join(root, ".scout", "seed-lists");
}

export function packagedSeedListDir() {
  return join(dirname(fileURLToPath(import.meta.url)), "seed-lists");
}

export function validateTrustedSeedListId(seedListId) {
  if (typeof seedListId !== "string" || seedListId.trim().length === 0) {
    throw new Error("Trusted seed-list id must be a non-empty string.");
  }
  const id = seedListId.trim();
  if (!SEED_LIST_ID_PATTERN.test(id)) {
    throw new Error(`Trusted seed-list id is not local-safe: ${seedListId}`);
  }
  return id;
}

export function seedListFileName(seedListId) {
  return `${validateTrustedSeedListId(seedListId)}.json`;
}

export async function loadTrustedSeedList(seedListId, options = {}) {
  const id = validateTrustedSeedListId(seedListId);
  const localPath = join(seedListStoreDir(options.root), seedListFileName(id));
  const packagedPath = join(packagedSeedListDir(), seedListFileName(id));

  try {
    return parseTrustedSeedList(await readFile(localPath, "utf8"), { expectedId: id, path: localPath });
  } catch (error) {
    if (error.code !== "ENOENT" || options.allowPackaged === false) {
      throw error;
    }
  }

  return parseTrustedSeedList(await readFile(packagedPath, "utf8"), { expectedId: id, path: packagedPath });
}

export async function loadTrustedSeedLists(seedListIds, options = {}) {
  if (!Array.isArray(seedListIds)) {
    throw new Error("Trusted seed-list ids must be an array.");
  }
  const lists = [];
  for (const seedListId of seedListIds) {
    lists.push(await loadTrustedSeedList(seedListId, options));
  }
  return lists;
}

export function validateTrustedSeedList(seedList, options = {}) {
  if (!seedList || typeof seedList !== "object" || Array.isArray(seedList)) {
    throw new Error("Trusted seed-list must be an object.");
  }
  const seedListId = validateTrustedSeedListId(seedList.seed_list_id);
  if (options.expectedId && seedListId !== options.expectedId) {
    throw new Error(`Trusted seed-list id mismatch: expected ${options.expectedId}, found ${seedListId}.`);
  }
  if (typeof seedList.name !== "string" || seedList.name.trim().length === 0) {
    throw new Error("Trusted seed-list name must be a non-empty string.");
  }
  if (!Array.isArray(seedList.repos)) {
    throw new Error("Trusted seed-list repos must be an array.");
  }
  return {
    seed_list_id: seedListId,
    name: seedList.name.trim(),
    repos: seedList.repos.map((entry, index) => normalizeSeedRepo(entry, `repos[${index}]`)),
  };
}

export function normalizeSeedRepo(entry, fieldName = "repo") {
  if (typeof entry === "string") {
    return { repo: validateRepoName(entry, fieldName) };
  }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`Trusted seed-list ${fieldName} must be a repo string or object.`);
  }
  return {
    repo: validateRepoName(entry.repo, `${fieldName}.repo`),
    labels: normalizeOptionalStringArray(entry.labels, `${fieldName}.labels`),
    languages: normalizeOptionalStringArray(entry.languages, `${fieldName}.languages`),
  };
}

export function validateRepoName(repoName, fieldName = "repo") {
  if (typeof repoName !== "string" || repoName.trim().length === 0) {
    throw new Error(`Trusted seed-list ${fieldName} must be a non-empty owner/repo string.`);
  }
  const repo = repoName.trim();
  if (!REPO_NAME_PATTERN.test(repo) || repo.includes("..") || repo.includes("://")) {
    throw new Error(`Trusted seed-list ${fieldName} is not a valid owner/repo name: ${repoName}`);
  }
  return repo;
}

function parseTrustedSeedList(raw, options) {
  try {
    return validateTrustedSeedList(JSON.parse(raw), options);
  } catch (error) {
    throw new Error(`Malformed trusted seed-list ${options.path}: ${error.message}`);
  }
}

function normalizeOptionalStringArray(value, fieldName) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`Trusted seed-list ${fieldName} must be an array.`);
  }
  return value.map((item) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error(`Trusted seed-list ${fieldName} entries must be non-empty strings.`);
    }
    return item.trim();
  });
}
