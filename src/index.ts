/**
 * AOS — Agent Operating System
 *
 * Entry point for the AOS standalone application.
 * Starts the Fastify HTTP server with dev endpoints.
 */

import { createServer } from './server';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function main(): Promise<void> {
  console.log('[AOS] Starting Agent Operating System v0.1.0');
  console.log('[AOS] Port:', PORT);

  const server = await createServer();
  await server.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[AOS] Server listening on http://0.0.0.0:${PORT}`);
  console.log('[AOS] Endpoints:');
  console.log('  GET  /health');
  console.log('  POST /dev/trigger-cron');
  console.log('  POST /dev/start-bpmn');
  console.log('  POST /dev/call-mcp');
}

main().catch((err) => {
  console.error('[AOS] Fatal:', err);
  process.exit(1);
});
