import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateSearchProfile } from "./validators.js";

export function createSearchProfile({
  name,
  languages = ["Python", "TypeScript"],
  labels = ["good first issue", "help wanted", "documentation"],
  include_queries = [],
  exclude_orgs = [],
  exclude_repos = [],
  trusted_seed_lists = [],
  max_candidates = 50,
  mode = "metadata_only",
  threshold_overrides = {},
}) {
  const now = new Date().toISOString();
  return validateSearchProfile({
    profile_id: `profile-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    name,
    languages,
    labels,
    include_queries,
    exclude_orgs,
    exclude_repos,
    trusted_seed_lists,
    max_candidates,
    mode,
    threshold_overrides,
    created_at: now,
    updated_at: now,
  });
}

export function queriesFromProfile(profile) {
  validateSearchProfile(profile);
  const queries = [];
  for (const label of profile.labels) {
    for (const language of profile.languages) {
      if (language === "Docs") {
        queries.push(`is:issue state:open label:"${label}" no:assignee`);
      } else {
        queries.push(`is:issue state:open label:"${label}" no:assignee language:${language}`);
      }
    }
  }
  return [...profile.include_queries, ...queries];
}

export function profileAllowsOperation(profile, operation) {
  validateSearchProfile(profile);
  const forbidden = new Set(["git_clone", "package_install", "shell_command", "repo_script_execution", "github_push"]);
  return !forbidden.has(operation);
}

export function profileStoreDir(root = process.cwd()) {
  return join(root, ".scout", "profiles");
}

export function profileFileName(profileName) {
  const slug = String(profileName)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) {
    throw new Error("Profile name must contain at least one alphanumeric character.");
  }
  return `${slug}.json`;
}

export async function saveSearchProfile(profile, options = {}) {
  const validated = validateSearchProfile(profile);
  const dir = profileStoreDir(options.root);
  await mkdir(dir, { recursive: true });
  const path = join(dir, profileFileName(validated.name));
  await writeFile(path, JSON.stringify(validated, null, 2), "utf8");
  return { profile: validated, path };
}

export async function loadSearchProfile(name, options = {}) {
  const path = join(profileStoreDir(options.root), profileFileName(name));
  const raw = await readFile(path, "utf8");
  return validateSearchProfile(JSON.parse(raw));
}
