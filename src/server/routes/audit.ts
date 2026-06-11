/**
 * Audit Routes — HTTP endpoints for querying AOS audit events.
 *
 * Endpoints:
 * - GET /api/aos/audit — query audit events with filters
 *
 * Query parameters:
 * - type: event type filter (e.g., aos.execution.started)
 * - actor: actor filter (e.g., hr-assistant)
 * - from: start date (ISO 8601)
 * - to: end date (ISO 8601)
 * - limit: max results (default: 100)
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuditEvent, AuditFilter } from '../../interfaces/audit';
import { AuditEventBridge, AOS_EVENT_TYPES } from '../../adapters/audit/audit-event-bridge';

/**
 * Register audit routes on a Fastify instance.
 *
 * Expects app.audit to be an AuditEventBridge instance.
 */
export default async function auditRoutes(app: FastifyInstance, _opts: Record<string, unknown>): Promise<void> {
  const audit = (app as any).audit as AuditEventBridge;

  if (!audit) {
    throw new Error('Audit bridge not configured on app.audit');
  }

  /**
   * GET /api/aos/audit
   * Query audit events with optional filters.
   */
  app.get('/audit', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string>;

    const filter: AuditFilter = {};

    if (query.type) {
      filter.type = query.type as string;
    }
    if (query.actor) {
      filter.actor = query.actor as string;
    }
    if (query.from) {
      filter.from = new Date(query.from as string);
    }
    if (query.to) {
      filter.to = new Date(query.to as string);
    }
    if (query.limit) {
      filter.limit = parseInt(query.limit as string, 10);
    }

    try {
      const events = await audit.query(filter);

      return reply.send({
        success: true,
        data: events.map((e: AuditEvent) => ({
          id: e.id,
          type: e.type,
          actor: e.actor,
          payload: e.payload,
          createdAt: e.createdAt,
          description: AuditEventBridge.getDescription(e.type),
        })),
        total: events.length,
      });
    } catch (err) {
      return reply.status(500).send({
        success: false,
        error: (err as Error).message,
      });
    }
  });

  /**
   * GET /api/aos/audit/types
   * List all known event types.
   */
  app.get('/audit/types', async (_request: FastifyRequest, reply: FastifyReply) => {
    const types = Object.entries(AOS_EVENT_TYPES).map(([type, description]) => ({
      type,
      description,
    }));

    return reply.send({
      success: true,
      data: types,
    });
  });

  /**
   * GET /api/aos/audit/summary
   * Get event count summary by type.
   */
  app.get('/audit/summary', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string>;
    const from = query.from ? new Date(query.from as string) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Default: last 7 days
    const to = query.to ? new Date(query.to as string) : new Date();

    try {
      const result = await audit.pgClient.query(
        `SELECT event_type, COUNT(*) as count, MAX(created_at) as last_seen
         FROM audit_event
         WHERE event_type LIKE 'aos.%'
           AND created_at >= $1
           AND created_at <= $2
         GROUP BY event_type
         ORDER BY count DESC`,
        [from.toISOString(), to.toISOString()],
      );

      return reply.send({
        success: true,
        data: result.rows.map((row: Record<string, unknown>) => ({
          type: row.event_type as string,
          count: parseInt(row.count as string, 10),
          lastSeen: row.last_seen as Date,
          description: AuditEventBridge.getDescription(row.event_type as string),
        })),
      });
    } catch (err) {
      return reply.status(500).send({
        success: false,
        error: (err as Error).message,
      });
    }
  });
}
