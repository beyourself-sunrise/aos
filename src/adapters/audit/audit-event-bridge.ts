/**
 * Audit Event Bridge — implements AOS Audit interface with dual-write
 * to both AOS-owned aos_audit and existing Beyourself audit_event tables.
 *
 * Event types:
 * - aos.session.* — session lifecycle (existing)
 * - aos.trigger.* — trigger events (existing)
 * - aos.mcp.* — MCP tool calls (existing)
 * - aos.execution.* — agent execution (MVP)
 * - aos.observation.* — memory operations (MVP)
 * - aos.workflow.* — workflow state changes (MVP)
 * - aos.persona.* — persona management (MVP)
 */

import { Client as PgClient } from 'pg';
import type { Audit, AuditEvent, AuditFilter } from '../../interfaces/audit';

/** Known AOS event type prefixes. */
export const AOS_EVENT_TYPES = {
  // Session lifecycle (existing)
  'aos.session.created': 'Session created',
  'aos.session.leaf.changed': 'Session leaf changed',
  'aos.session.entry.appended': 'Session entry appended',
  // Trigger events (existing)
  'aos.trigger.cron.received': 'Cron trigger received',
  'aos.trigger.kafka.received': 'Kafka trigger received',
  'aos.trigger.slack.received': 'Slack trigger received',
  'aos.trigger.report.received': 'Report trigger received',
  'aos.trigger.webhook.received': 'Webhook trigger received',
  // MCP events (existing)
  'aos.mcp.tool.called': 'MCP tool called',
  // Execution events (MVP)
  'aos.execution.started': 'Agent execution started',
  'aos.execution.completed': 'Agent execution completed',
  'aos.execution.failed': 'Agent execution failed',
  // Observation events (MVP)
  'aos.observation.stored': 'Observation stored in memory',
  'aos.observation.recalled': 'Observations recalled from memory',
  // Workflow events (MVP)
  'aos.workflow.transitioned': 'Workflow state transitioned',
  'aos.workflow.timeout': 'Workflow timed out',
  'aos.workflow.woken': 'Workflow woken by trigger',
  // Persona events (MVP)
  'aos.persona.initialized': 'Persona agent initialized',
  'aos.persona.switched': 'User switched persona',
} as const;

/** All known event type keys. */
export type AosEventType = keyof typeof AOS_EVENT_TYPES;

/**
 * AuditEventBridge — dual-write audit logging.
 */
export class AuditEventBridge implements Audit {
  constructor(
    private pgClient: PgClient,
    private schema: string = 'public',
  ) {}

  /**
   * Log an audit event to both AOS and Beyourself audit tables.
   */
  async log(event: AuditEvent): Promise<void> {
    const id = event.id ?? crypto.randomUUID();
    const type = event.type;
    const actor = event.actor;
    const payload = JSON.stringify(event.payload);
    const createdAt = event.createdAt?.toISOString() ?? new Date().toISOString();

    // Write to AOS-owned table
    try {
      await this.pgClient.query(
        `INSERT INTO ${this.schema}.aos_audit (id, type, actor, payload, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [id, type, actor, payload, createdAt],
      );
    } catch {
      // aos_audit table may not exist in POC env; continue to audit_event
    }

    // Write to existing audit_event table
    try {
      await this.pgClient.query(
        `INSERT INTO ${this.schema}.audit_event (id, event_type, actor, payload, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [id, type, actor, payload, createdAt],
      );
    } catch {
      // audit_event table may not exist in POC env; log to console
      console.log(`[Audit] ${type} by ${actor}:`, event.payload);
    }
  }

  /**
   * Query audit events with filtering.
   */
  async query(filter: AuditFilter): Promise<AuditEvent[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let argIdx = 1;

    if (filter.type) {
      conditions.push(`type = $${argIdx++}`);
      params.push(filter.type);
    }
    if (filter.actor) {
      conditions.push(`actor = $${argIdx++}`);
      params.push(filter.actor);
    }
    if (filter.from) {
      conditions.push(`created_at >= $${argIdx++}`);
      params.push(filter.from.toISOString());
    }
    if (filter.to) {
      conditions.push(`created_at <= $${argIdx++}`);
      params.push(filter.to.toISOString());
    }
    if (filter.payloadMatch) {
      for (const [key, value] of Object.entries(filter.payloadMatch)) {
        conditions.push(`payload->>'${key}' = $${argIdx++}`);
        params.push(value);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit ?? 100;

    try {
      const result = await this.pgClient.query(
        `SELECT id, type, actor, payload, created_at FROM ${this.schema}.audit_event ${whereClause} ORDER BY created_at DESC LIMIT $${argIdx}`,
        [...params, limit],
      );
      return result.rows.map((row: Record<string, unknown>) => ({
        id: row.id as string,
        type: row.type as string,
        actor: row.actor as string,
        payload: row.payload,
        createdAt: row.created_at as Date,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get description for an event type.
   */
  static getDescription(type: string): string {
    return (AOS_EVENT_TYPES as Record<string, string>)[type] ?? type;
  }
}
