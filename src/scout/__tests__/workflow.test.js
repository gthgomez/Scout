import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { createSessionManifest, parseThroughStages, resolvePendingStages } from "../session.js";
import { executeWorkflow } from "../workflow.js";

const fixturesPath = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const reportFixtures = JSON.parse(readFileSync(join(fixturesPath, "report-model.json"), "utf8"));

describe("session manifest", () => {
  it("parses through stages and resolves pending resume stages", () => {
    assert.deepEqual(parseThroughStages("discover,cockpit,handoff"), ["discover", "cockpit", "handoff"]);
    const manifest = createSessionManifest({
      sessionId: "scout_session",
      profile: { name: "test" },
      stagesCompleted: ["discover"],
    });
    assert.deepEqual(resolvePendingStages(manifest), ["static", "cockpit", "handoff"]);
  });
});

describe("workflow execution", () => {
  it("writes handoff schema 1.1 through discover,cockpit,handoff", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "scout-workflow-"));
    try {
      const report = reportFixtures.validReport;

      await executeWorkflow({
        outDir,
        profileModel: { name: "test", profile_id: "profile-test", discovery_intent: "beginner" },
        report,
        through: "discover,cockpit,handoff",
        shortlistLimit: 5,
        renderAgentSummary: () => "# summary",
        createNextActions: () => [],
      });

      const handoff = JSON.parse(readFileSync(join(outDir, "handoff_package.json"), "utf8"));
      assert.equal(handoff.schema_version, "1.1");
      assert.equal(handoff.entrypoint, "handoff_package.json");
      assert.ok(Array.isArray(handoff.recommended_packages));
      assert.ok(readFileSync(join(outDir, "scout_cockpit.json"), "utf8").includes("SCOUT-alpha-green-1"));
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
