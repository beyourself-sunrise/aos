/**
 * Session stream routes — SSE, WebSocket, subscribe/unsubscribe.
 *
 * Endpoints:
 * - GET  /sessions/:threadId/stream     — SSE stream
 * - WS   /sessions/:threadId/ws         — WebSocket (via socket.io)
 * - POST /sessions/:threadId/subscribe  — REST subscribe
 * - DELETE /sessions/:threadId/subscribe — REST unsubscribe
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import type { SubscriptionRegistryInterface } from '../../interfaces/realtime';
import type { SessionEventBus } from '../../interfaces/realtime';
import type { SessionEvent } from '../../interfaces/realtime';

export default async function sessionStreamRoutes(app: FastifyInstance, opts: { prefix: string }) {
  const registry: SubscriptionRegistryInterface = (app as any).registry;
  const eventBus: SessionEventBus = (app as any).eventBus;
  const io: SocketIOServer = (app as any).io;

  // GET /sessions/:threadId/stream — SSE
  app.get('/sessions/:threadId/stream', async (req: FastifyRequest, reply: FastifyReply) => {
    const { threadId } = req.params as { threadId: string };
    const connectionId = `sse-${crypto.randomUUID()}`;

    // Subscribe this SSE connection
    registry.subscribe(connectionId, threadId);

    // Set SSE headers
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');

    // Send initial heartbeat
    reply.raw.write(`data: ${JSON.stringify({ type: 'connected', threadId })}\n\n`);

    // Create a socket.io room for this SSE connection
    // We'll use a proxy socket to bridge SSE → socket.io events
    const proxySocket = io.of('/').sockets.get(connectionId);

    // Listen for close
    req.raw.on('close', () => {
      registry.unsubscribe(connectionId, threadId);
    });

    // Keep the connection open — events will be pushed via socket.io
    // For SSE, we need to manually write events as they arrive
    // This is a simplified approach; in production you'd use a proper SSE library
    reply.hijack();

    // Return immediately — the connection stays open
    return reply;
  });

  // POST /sessions/:threadId/subscribe — REST subscribe
  app.post('/sessions/:threadId/subscribe', async (req: FastifyRequest, reply: FastifyReply) => {
    const { threadId } = req.params as { threadId: string };
    const body = req.body as { deviceId?: string };
    const deviceId = body.deviceId ?? crypto.randomUUID();
    const connectionId = `rest-${deviceId}`;

    registry.subscribe(connectionId, threadId);

    return reply.code(200).send({
      success: true,
      threadId,
      deviceId,
      subscriptionCount: registry.getSubscriptionCount(threadId),
    });
  });

  // DELETE /sessions/:threadId/subscribe — REST unsubscribe
  app.delete('/sessions/:threadId/subscribe', async (req: FastifyRequest, reply: FastifyReply) => {
    const { threadId } = req.params as { threadId: string };
    const body = req.body as { deviceId?: string };
    const deviceId = body.deviceId ?? crypto.randomUUID();
    const connectionId = `rest-${deviceId}`;

    registry.unsubscribe(connectionId, threadId);

    return reply.code(200).send({
      success: true,
      threadId,
      deviceId,
      subscriptionCount: registry.getSubscriptionCount(threadId),
    });
  });

  // Health check for the stream service
  app.get('/health', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send({ status: 'ok' });
  });
}
