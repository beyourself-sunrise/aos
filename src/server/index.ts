/**
 * AOS Server — Fastify + socket.io integration.
 *
 * This is the main entry point for the AOS realtime service.
 * It wires together:
 * - Fastify (HTTP + SSE)
 * - socket.io (WebSocket + rooms)
 * - Kafka (pub/sub for session events)
 * - AOS adapters (SessionEventBus, RealTimeStreamService, etc.)
 */

import Fastify, { FastifyInstance } from 'fastify';
import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { Kafka } from 'kafkajs';
import { KafkaSessionEventBus } from '../adapters/realtime/session-event-bus';
import { RealTimeStreamService } from '../adapters/realtime/realtime-stream-service';
import { SubscriptionRegistry } from '../adapters/realtime/subscription-registry';
import { CrossDeviceConflictResolver } from '../adapters/realtime/conflict-resolver';
import sessionStreamRoutes from './routes/session-stream';
import auditRoutes from './routes/audit';

export async function createServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  // socket.io
  const server = app.server as HttpServer;
  const io = new SocketIOServer(server, {
    cors: { origin: '*' },
    path: '/api/aos/socket.io',
  });

  // Kafka
  const kafka = new Kafka({
    clientId: 'aos-server',
    brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
  });

  // AOS adapters
  const registry = new SubscriptionRegistry();
  const eventBus = new KafkaSessionEventBus(kafka);
  const conflictResolver = new CrossDeviceConflictResolver();
  const streamService = new RealTimeStreamService(io, kafka, registry);

  // Attach to app for route access
  (app as any).registry = registry;
  (app as any).eventBus = eventBus;
  (app as any).io = io;
  (app as any).conflictResolver = conflictResolver;
  (app as any).streamService = streamService;

  // socket.io connection handler
  io.on('connection', (socket: Socket) => {
    const deviceId = (socket.handshake.auth as { deviceId?: string })?.deviceId ?? crypto.randomUUID();
    (socket as any).deviceId = deviceId;
    app.log.info(`Client connected: ${socket.id} (device: ${deviceId})`);

    socket.on('subscribe', (threadId: string) => {
      registry.subscribe(socket.id, threadId);
      app.log.info(`Client ${socket.id} subscribed to ${threadId}`);
    });

    socket.on('unsubscribe', (threadId: string) => {
      registry.unsubscribe(socket.id, threadId);
      app.log.info(`Client ${socket.id} unsubscribed from ${threadId}`);
    });

    socket.on('disconnect', () => {
      registry.unsubscribeAll(socket.id);
      app.log.info(`Client ${socket.id} disconnected`);
    });
  });

  // Register routes
  await app.register(sessionStreamRoutes, { prefix: '/api/aos' });
  await app.register(auditRoutes, { prefix: '/api/aos' });

  // Start services
  await eventBus.start();
  await streamService.start();

  // Graceful shutdown
  app.addHook('onClose', async () => {
    await eventBus.stop();
    await streamService.stop();
    await io.close();
  });

  return app;
}

// Start server if run directly
const isMainModule = require.main === module;
if (isMainModule) {
  (async () => {
    const app = await createServer();
    await app.listen({ port: 3000, host: '0.0.0.0' });
    app.log.info('AOS server listening on port 3000');
  })();
}
