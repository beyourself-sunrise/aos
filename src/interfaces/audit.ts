/**
 * AOS Audit Interface (SSOT)
 * Audit logging abstraction — records all AOS actions to both AOS-owned
 * and existing Beyourself audit_event tables.
 * OSS implementation: @opentelemetry/* (Apache-2.0)
 */

export interface Audit {
  log(event: AuditEvent): Promise<void>;
  query(filter: AuditFilter): Promise<AuditEvent[]>;
}

export interface AuditEvent {
  id: string;
  type: string;
  actor: string;
  payload: unknown;
  createdAt?: Date;
}

export interface AuditFilter {
  type?: string;
  actor?: string;
  payloadMatch?: Record<string, unknown>;
  from?: Date;
  to?: Date;
  limit?: number;
}
