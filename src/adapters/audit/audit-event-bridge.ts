/**
 * Audit Event Bridge — implements AOS Audit interface with dual-write
 * to both AOS-owned aos_audit and existing Beyourself audit_event tables.
 */

import { Client as PgClient } from 'pg';
import type { Audit, AuditEvent, AuditFilter } from '../../interfaces/audit';

export class AuditEventBridge implements Audit {
  constructor(
    private pgClient: PgClient,
    private schema: string = 'public',
  ) {}

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
}
