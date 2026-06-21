#!/usr/bin/env node
import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const dir = join(process.cwd(), "src", "scout");
const entries = await readdir(dir, { withFileTypes: true });
const files = entries.filter((e) => e.isFile() && e.name.endsWith(".js")).map((e) => join(dir, e.name));

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
