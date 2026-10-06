import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateEgressHost,
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
    assert.ok(output.includes("dry-run plan"));
    assert.ok(output.includes("install_probe_design"));
    assert.ok(output.includes("bridge networking"));
  });

  it("renders executable approval text for install_probe contracts", () => {
    const output = renderNetworkApprovalText(
      validContract({
        command_set: "install_probe",
        approval_phrase:
          "APPROVE SCOUT R2D SCOUT-alpha-green-1 acme/tooling https://github.com/acme/tooling/issues/12 registry_allowlist registry.npmjs.org pypi.org files.pythonhosted.org install_probe scripts_disabled 120 retain_stdout_stderr_7_days",
      }),
    );

    assert.ok(output.includes("executable `scout probe`"));
    assert.ok(output.includes("install_probe"));
    assert.ok(output.includes("bridge networking"));
    assert.ok(!output.includes("readonly at runtime"));
  });

  it("renders a design report section without implying execution", () => {
    const output = renderNetworkDesignReportSection(validContract());

    assert.ok(output.includes("dry-run planning only"));
    assert.ok(output.includes("bridge networking"));
  });

  it("renders an executable report section for install_probe contracts", () => {
    const output = renderNetworkDesignReportSection(
      validContract({
        command_set: "install_probe",
        approval_phrase:
          "APPROVE SCOUT R2D SCOUT-alpha-green-1 acme/tooling https://github.com/acme/tooling/issues/12 registry_allowlist registry.npmjs.org pypi.org files.pythonhosted.org install_probe scripts_disabled 120 retain_stdout_stderr_7_days",
      }),
    );

    assert.ok(output.includes("executable via `scout probe`"));
    assert.ok(!output.includes("rejecting `registry_allowlist`"));
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

describe("capability boundary: egress allowlist enforcement", () => {
  it("blocks commands with non-allowlisted hosts in argv", () => {
    const result = evaluateEgressHost("registry.npmjs.org", ["pypi.org", "files.pythonhosted.org"]);

    assert.equal(result.decision, "denied");
    assert.ok(result.reason.includes("outside approved registry allowlist"));
  });

  it("allows commands with allowlisted hosts", () => {
    const result = evaluateEgressHost("registry.npmjs.org", ["registry.npmjs.org", "pypi.org"]);

    assert.equal(result.decision, "allowed");
    assert.ok(result.reason.includes("matched approved registry allowlist"));
  });

  it("blocks commands with missing observed host", () => {
    const result = evaluateEgressHost("", ["registry.npmjs.org"]);

    assert.equal(result.decision, "denied");
    assert.ok(result.reason.includes("Missing observed host"));
  });

  it("blocks commands with null observed host", () => {
    const result = evaluateEgressHost(null, ["registry.npmjs.org"]);

    assert.equal(result.decision, "denied");
    assert.ok(result.reason.includes("Missing observed host"));
  });

  it("is case-insensitive for host matching", () => {
    const result = evaluateEgressHost("REGISTRY.NPMJS.ORG", ["registry.npmjs.org"]);

    assert.equal(result.decision, "allowed");
  });

  it("documents the bypass gap: fallback to approvedHosts[0] when no pattern matches", () => {
    // KNOWN LIMITATION: When inferRegistryHostFromCommand cannot find a known
    // registry pattern (npm, pip, yarn, pnpm) in the command argv, it falls back
    // to approvedHosts[0]. Since approvedHosts[0] is always in the approved set,
    // evaluateEgressHost will return "allowed" — meaning ANY command that doesn't
    // match a known registry pattern is implicitly allowed.
    //
    // This is a pre-execution argv-inferred check, NOT runtime packet filtering.
    // The honesty note in approval text and design reports documents this gap.
    const approvedHosts = ["registry.npmjs.org", "pypi.org"];

    // Simulate the fallback: inferRegistryHostFromCommand returns approvedHosts[0]
    // when no known registry pattern matches the command.
    const fallbackHost = approvedHosts[0];
    const result = evaluateEgressHost(fallbackHost, approvedHosts);

    // The fallback host is always in the approved set, so it's always "allowed".
    // This demonstrates the bypass gap: commands without recognizable registry
    // patterns are allowed by default.
    assert.equal(result.decision, "allowed");
    assert.equal(fallbackHost, "registry.npmjs.org");
  });
});

describe("capability boundary: honesty note rendering", () => {
  it("renders the honesty note in approval text", () => {
    const output = renderNetworkApprovalText(validContract());

    assert.ok(output.includes("Egress limitation:"));
    assert.ok(output.includes("argv"));
    assert.ok(output.includes("bridge networking"));
    assert.ok(output.includes("does not enforce packet-level egress filtering"));
    assert.ok(output.includes("blocked pre-execution"));
  });

  it("renders the honesty note in design reports", () => {
    const output = renderNetworkDesignReportSection(validContract());

    assert.ok(output.includes("Egress limitation:"));
    assert.ok(output.includes("argv"));
    assert.ok(output.includes("bridge networking"));
    assert.ok(output.includes("does not enforce packet-level egress filtering"));
    assert.ok(output.includes("blocked pre-execution"));
  });

  it("renders the honesty note in executable probe approval text", () => {
    const output = renderNetworkApprovalText(
      validContract({
        command_set: "install_probe",
        approval_phrase:
          "APPROVE SCOUT R2D SCOUT-alpha-green-1 acme/tooling https://github.com/acme/tooling/issues/12 registry_allowlist registry.npmjs.org pypi.org files.pythonhosted.org install_probe scripts_disabled 120 retain_stdout_stderr_7_days",
      }),
    );

    assert.ok(output.includes("Egress limitation:"));
    assert.ok(output.includes("does not enforce packet-level egress filtering"));
  });

  it("renders the honesty note in executable design reports", () => {
    const output = renderNetworkDesignReportSection(
      validContract({
        command_set: "install_probe",
        approval_phrase:
          "APPROVE SCOUT R2D SCOUT-alpha-green-1 acme/tooling https://github.com/acme/tooling/issues/12 registry_allowlist registry.npmjs.org pypi.org files.pythonhosted.org install_probe scripts_disabled 120 retain_stdout_stderr_7_days",
      }),
    );

    assert.ok(output.includes("Egress limitation:"));
    assert.ok(output.includes("does not enforce packet-level egress filtering"));
  });
});
