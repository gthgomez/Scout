import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { assertAllowed, createDenialMessage, defaultPolicy, decideOperation } from "../policy.js";

const fixtures = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "policy.json"), "utf8"),
);

describe("policy controls", () => {
  it("builds default metadata-only policy", () => {
    const expected = fixtures.metadata_only;
    const actual = defaultPolicy();
    assert.equal(actual.mode, expected.mode);
    assert.deepStrictEqual(actual.allowed_operations, expected.allowed_operations);
    assert.deepStrictEqual(actual.denied_operations, expected.denied_operations);
    assert.deepStrictEqual(actual.requires_approval, expected.requires_approval);
  });

  it("adds static inspection allowlist entries", () => {
    const expected = fixtures.static_inspection;
    const actual = defaultPolicy("static_inspection");
    assert.deepStrictEqual(actual.allowed_operations, expected.allowed_operations);
  });

  it("denies forbidden operations with explicit reason", () => {
    const policy = defaultPolicy();
    const decision = decideOperation(policy, fixtures.single_denial_op);
    assert.equal(decision.decision, "denied");
    assert.match(decision.reason, /is denied by Scout policy/);
  });

  it("denies operations requiring approval in deny state", () => {
    const policy = defaultPolicy();
    const decision = decideOperation(policy, fixtures.approval_op);
    assert.equal(decision.decision, "denied");
    assert.equal(decision.approval_id, null);
    assert.match(decision.reason, /requires approval/);
  });

  it("throws typed denial errors for blocked operations", () => {
    const policy = defaultPolicy();
    assert.throws(() => assertAllowed(policy, fixtures.single_denial_op), (err) => {
      assert.equal(err.code, "SCOUT_POLICY_DENIED");
      assert.equal(err.operation, fixtures.single_denial_op);
      assert.equal(err.policyDecision.decision, "denied");
      return true;
    });
  });

  it("format denial messages with safe next action", () => {
    const message = createDenialMessage("shell_command", "unsafe operation", "Use metadata-only search APIs.");
    assert.match(message, /DENIED: shell_command is blocked/);
    assert.match(message, /Reason: unsafe operation/);
    assert.match(message, /Next safe action: Use metadata-only search APIs./);
  });

  it("rejects unknown operations", () => {
    const policy = defaultPolicy();
    const decision = decideOperation(policy, "unlisted_operation");
    assert.equal(decision.decision, "denied");
    assert.match(decision.reason, /unknown or not allowlisted/);
  });

  it("keeps sandbox operations approval-bound to dynamic probe mode", () => {
    for (const operation of fixtures.metadata_only.sandbox_operations) {
      assert.equal(decideOperation(defaultPolicy("metadata_only"), operation, "approval-1").decision, "denied");
      assert.equal(decideOperation(defaultPolicy("static_inspection"), operation, "approval-1").decision, "denied");
      assert.equal(decideOperation(defaultPolicy("dynamic_probe"), operation).decision, "denied");
      assert.equal(decideOperation(defaultPolicy("dynamic_probe"), operation, "approval-1").decision, "allowed");
    }
  });

  it("still denies install, repo script, and GitHub write actions in dynamic probe mode", () => {
    const policy = defaultPolicy("dynamic_probe");

    assert.equal(decideOperation(policy, "package_install", "approval-1").decision, "denied");
    assert.equal(decideOperation(policy, "repo_script_execution", "approval-1").decision, "denied");
    assert.equal(decideOperation(policy, "github_pr_open", "approval-1").decision, "denied");
  });
});
