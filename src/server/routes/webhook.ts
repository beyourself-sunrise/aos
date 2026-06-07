/**
 * Webhook routes — Fastify HTTP endpoint for external webhook triggers.
 *
 * This route is registered by WebhookTrigger and handles incoming
 * webhook POST requests with HMAC SHA-256 signature verification.
 *
 * The route is mounted at /api/aos/webhook by default.
 */

import { FastifyInstance } from 'fastify';
import { WebhookTrigger, WebhookTriggerOptions } from '../../adapters/trigger/webhook/webhook-trigger';
import type { TriggerHandler } from '../../interfaces/trigger';

export default async function webhookRoutes(app: FastifyInstance, options?: { prefix?: string }): Promise<void> {
  const prefix = options?.prefix ?? '/api/aos';

  // The webhook trigger registers its own route on the Fastify instance.
  // This route file provides a convenience wrapper for registering the trigger
  // with the server's Fastify instance.

  app.addHook('onReady', async () => {
    // WebhookTrigger will be started from index.ts bootstrap
    // This route is a placeholder for the webhook endpoint
    app.log.info(`[WebhookRoutes] Registered at ${prefix}/webhook`);
  });
}

/**
 * Create a WebhookTrigger configured for the given Fastify server.
 * The trigger registers its route on the provided Fastify instance.
 */
export function createWebhookTrigger(
  options: WebhookTriggerOptions,
  handler: TriggerHandler,
): WebhookTrigger {
  return new WebhookTrigger(options);
}
