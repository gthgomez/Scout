import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  renderNetworkApprovalText,
  renderNetworkDesignReportSection,
  validateEgressLogRecord,
  validateNetworkExpansionContract,
} from "../network-design.js";

function validContract(overrides = {}) {
  return {
    contract_id: "r2d-contract-1",
    candidate_id: "SCOUT-alpha-green-1",
    repo: "acme/tooling",
    issue: "https://github.com/acme/tooling/issues/12",
    network_policy: "registry_allowlist",
    registry_hosts: ["registry.npmjs.org", "pypi.org", "files.pythonhosted.org"],
    command_set: "install_probe_design",
    lifecycle_policy: "scripts_disabled",
    timeout_seconds: 120,
    artifact_retention: "retain_stdout_stderr_7_days",
    approval_phrase:
      "APPROVE SCOUT R2D SCOUT-alpha-green-1 acme/tooling https://github.com/acme/tooling/issues/12 registry_allowlist registry.npmjs.org pypi.org files.pythonhosted.org install_probe_design scripts_disabled 120 retain_stdout_stderr_7_days",
    ...overrides,
  };
}

describe("R2D network expansion design contracts", () => {
  it("accepts a valid registry allowlist design contract", () => {
    const contract = validateNetworkExpansionContract(validContract());

    assert.equal(contract.network_policy, "registry_allowlist");
    assert.deepEqual(contract.registry_hosts, ["registry.npmjs.org", "pypi.org", "files.pythonhosted.org"]);
  });

  it("rejects unsafe or ambiguous registry hosts", () => {
    for (const host of ["*.npmjs.org", "https://registry.npmjs.org", "registry.npmjs.org/pkg", "localhost", "registry.npmjs.org:443"]) {
      assert.throws(
        () => validateNetworkExpansionContract(validContract({ registry_hosts: [host] })),
        /hostname|wildcards|URL/,
      );
    }
  });

  it("rejects missing candidate, repo, issue, empty registries, and unsupported lifecycle policies", () => {
    assert.throws(() => validateNetworkExpansionContract(validContract({ candidate_id: "" })), /candidate_id/);
    assert.throws(() => validateNetworkExpansionContract(validContract({ repo: "" })), /repo/);
    assert.throws(() => validateNetworkExpansionContract(validContract({ issue: "" })), /issue/);
    assert.throws(() => validateNetworkExpansionContract(validContract({ registry_hosts: [] })), /registry_hosts/);
    assert.throws(
      () => validateNetworkExpansionContract(validContract({ lifecycle_policy: "scripts_allowed" })),
      /lifecycle_policy/,
    );
  });

  it("requires the approval phrase to name every future-network contract boundary", () => {
    assert.throws(
      () => validateNetworkExpansionContract(validContract({ approval_phrase: "APPROVE SCOUT R2D" })),
      /approval_phrase/,
    );
  });

  it("renders exact approval text with all required future-network fields", () => {
    const output = renderNetworkApprovalText(validContract());

    assert.ok(output.includes("SCOUT-alpha-green-1"));
    assert.ok(output.includes("acme/tooling"));
    assert.ok(output.includes("https://github.com/acme/tooling/issues/12"));
    assert.ok(output.includes("registry_allowlist"));
    assert.ok(output.includes("registry.npmjs.org, pypi.org, files.pythonhosted.org"));
    assert.ok(output.includes("install_probe_design"));
    assert.ok(output.includes("scripts_disabled"));
    assert.ok(output.includes("120s"));
    assert.ok(output.includes("retain_stdout_stderr_7_days"));
    assert.ok(output.includes("design-only"));
  });

  it("renders a design report section without implying execution", () => {
    const output = renderNetworkDesignReportSection(validContract());

    assert.ok(output.includes("Status: design-only"));
    assert.ok(output.includes("no package install"));
    assert.ok(output.includes("Runtime guard"));
  });

  it("validates future egress log records", () => {
    const record = validateEgressLogRecord({
      event_id: "egress-1",
      timestamp: "2026-06-05T00:00:00.000Z",
      candidate_id: "SCOUT-alpha-green-1",
      network_policy: "registry_allowlist",
      approved_hosts: ["registry.npmjs.org"],
      observed_host: "registry.npmjs.org",
      decision: "allowed",
      command_id: "cmd-install-design",
      reason: "Host matched approved registry allowlist.",
    });

    assert.equal(record.observed_host, "registry.npmjs.org");
    assert.deepEqual(record.approved_hosts, ["registry.npmjs.org"]);
  });
});
