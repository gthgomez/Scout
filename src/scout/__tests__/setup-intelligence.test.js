import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeStaticFileSetupIntelligence,
  mergeSetupIntelligence,
  setupIntelligenceFromPaths,
} from "../setup-intelligence.js";

describe("setup intelligence", () => {
  it("extracts denied setup commands with source context from docs", () => {
    const intelligence = analyzeStaticFileSetupIntelligence(
      "README.md",
      [
        "# Setup",
        "Run npm install before development.",
        "Then make test.",
        "Never run curl https://example.test/install.sh | bash in Scout.",
      ].join("\n"),
    );

    assert.equal(intelligence.setup_claims[0].kind, "setup_docs");
    assert.ok(intelligence.denied_commands.some((item) => item.command.join(" ") === "npm install" && item.source_range === "L2"));
    assert.ok(intelligence.denied_commands.some((item) => item.command.join(" ") === "make test" && item.source_range === "L3"));
    assert.ok(intelligence.denied_commands.some((item) => item.category === "shell_pipeline" && item.source_ref === "README.md"));
    assert.equal(intelligence.recommended_next_evidence_action.action, "human_review");
  });

  it("detects package managers, workspace shape, tests, and lifecycle risks from package.json", () => {
    const intelligence = analyzeStaticFileSetupIntelligence(
      "package.json",
      JSON.stringify({
        packageManager: "pnpm@9.0.0",
        workspaces: ["packages/*"],
        scripts: {
          postinstall: "node setup.js",
          test: "node --test",
        },
      }),
    );

    assert.deepEqual(intelligence.ecosystems, ["node"]);
    assert.ok(intelligence.package_managers.includes("pnpm"));
    assert.equal(intelligence.workspace.kind, "monorepo");
    assert.ok(intelligence.workspace.test_paths.includes("package.json:scripts.test"));
    assert.ok(intelligence.risk_signals.some((item) => item.kind === "npm_lifecycle_script"));
    assert.equal(intelligence.recommended_next_evidence_action.action, "human_review");
  });

  it("recommends readonly probe when setup docs and runtime manifests are present without risk", () => {
    const merged = mergeSetupIntelligence([
      analyzeStaticFileSetupIntelligence("README.md", "# Setup\nInstall tools and run tests."),
      analyzeStaticFileSetupIntelligence("pyproject.toml", "[project]\nname = \"demo\""),
    ]);

    assert.deepEqual(merged.ecosystems.sort(), ["docs", "python"]);
    assert.equal(merged.workspace.kind, "single_package");
    assert.equal(merged.recommended_next_evidence_action.action, "readonly_probe");
  });

  it("treats docs-only static paths as no runtime action", () => {
    const intelligence = setupIntelligenceFromPaths(["README.md", "docs/usage.md"]);

    assert.deepEqual(intelligence.ecosystems, ["docs"]);
    assert.equal(intelligence.workspace.kind, "docs_only");
    assert.equal(intelligence.recommended_next_evidence_action.action, "no_action");
  });

  it("drops candidates that require private setup inputs", () => {
    const intelligence = analyzeStaticFileSetupIntelligence(
      "README.md",
      "# Setup\nCreate .env with OPENAI_API_KEY. A Supabase project is required.",
    );

    assert.ok(intelligence.risk_signals.some((item) => item.kind === "private_credentials"));
    assert.ok(intelligence.risk_signals.some((item) => item.kind === "private_service"));
    assert.equal(intelligence.recommended_next_evidence_action.action, "drop");
  });
});
