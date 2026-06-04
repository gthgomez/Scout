export function createAuditEvent({
  operation,
  mode,
  decision,
  reason,
  candidate_id = null,
  approval_id = null,
}) {
  return {
    event_id: `audit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: new Date().toISOString(),
    operation,
    mode,
    decision,
    reason,
    candidate_id,
    approval_id,
    redactions_applied: true,
  };
}

export class AuditLog {
  constructor() {
    this.events = [];
  }

  record(input) {
    const event = createAuditEvent(input);
    this.events.push(event);
    return event;
  }

  all() {
    return [...this.events];
  }
}

