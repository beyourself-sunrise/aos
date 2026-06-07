/**
 * Webhook Trigger — implements AOS Trigger interface using Fastify HTTP POST + HMAC SHA-256.
 *
 * Accepts HTTPS POST requests from external sources (ERPNext, GitHub, custom systems).
 * Each source registers with its own secret for HMAC verification.
 * Signature is sent in X-AOS-Signature header.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Trigger, TriggerHandler, TriggerEvent, WebhookTriggerConfig } from '../../../interfaces/trigger';

export interface WebhookSource {
  /** Source identifier (e.g., 'erpnext', 'github', 'custom-system') */
  name: string;
  /** HMAC secret for this source */
  secret: string;
}

export interface WebhookTriggerOptions {
  /** HTTP path for webhook endpoint */
  path: string;
  /** HTTP method (default: POST) */
  method?: 'POST' | 'PUT' | 'GET';
  /** Registered sources with their secrets */
  sources: WebhookSource[];
  /** Maximum payload size in bytes (default: 1MB) */
  maxPayloadSize?: number;
}

export class WebhookTrigger implements Trigger {
  readonly type = 'webhook' as const;

  private server: FastifyInstance | null = null;
  private handler: TriggerHandler | null = null;
  private sources: Map<string, string>;
  private path: string;
  private method: string;
  private maxPayloadSize: number;
  private running = false;

  constructor(private config: WebhookTriggerOptions) {
    this.sources = new Map(config.sources.map(s => [s.name, s.secret]));
    this.path = config.path;
    this.method = config.method ?? 'POST';
    this.maxPayloadSize = config.maxPayloadSize ?? 1024 * 1024; // 1MB
  }

  async start(handler: TriggerHandler): Promise<void> {
    if (this.running) {
      return;
    }
    this.handler = handler;
    this.running = true;

    this.server = Fastify({ logger: true });

    // Set body limit
    this.server.addHook('onRawRequest', (req, _res, callback) => {
      let data = '';
      req.on('data', chunk => {
        data += chunk;
        if (data.length > this.maxPayloadSize) {
          req.destroy();
        }
      });
      req.on('end', callback);
    });

    // Register the webhook route
    this.server.addHook('onRoute', () => {});
    this.server.route({
      method: this.method as any,
      url: this.path,
      handler: this.handleWebhook.bind(this),
    });

    console.log(`[WebhookTrigger] Started on ${this.method} ${this.path} with ${this.sources.size} sources`);
  }

  async stop(): Promise<void> {
    if (!this.running || !this.server) {
      return;
    }
    this.running = false;
    await this.server.close();
    this.server = null;
    console.log('[WebhookTrigger] Stopped');
  }

  private async handleWebhook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!this.handler || !this.running) {
      reply.code(503).send({ error: 'Service unavailable' });
      return;
    }

    // Verify HMAC signature
    const signature = request.headers['x-aos-signature'] as string;
    if (!signature) {
      reply.code(401).send({ error: 'Missing X-AOS-Signature header' });
      return;
    }

    const body = JSON.stringify(request.body);
    const sourceName = request.headers['x-aos-source'] as string | undefined;

    // Find matching source and verify signature
    let verified = false;
    for (const [name, secret] of this.sources) {
      if (sourceName && name !== sourceName) {
        continue;
      }

      const expected = createHmac('sha256', secret).update(body).digest('hex');
      if (this.compareSignatures(signature, expected)) {
        verified = true;
        break;
      }
    }

    if (!verified) {
      reply.code(401).send({ error: 'Invalid HMAC signature' });
      return;
    }

    // Process the webhook event
    const event: TriggerEvent = {
      type: 'webhook',
      payload: {
        source: sourceName ?? 'unknown',
        body: request.body,
        headers: request.headers,
      },
      timestamp: new Date(),
      source: sourceName ?? 'unknown',
    };

    try {
      await this.handler.onTrigger(event);
      reply.code(200).send({ received: true });
    } catch (err) {
      console.error('[WebhookTrigger] Handler error:', err);
      reply.code(500).send({ error: 'Internal error' });
    }
  }

  private compareSignatures(a: string, b: string): boolean {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) {
      return false;
    }
    return timingSafeEqual(aBuf, bBuf);
  }

  /**
   * Simulate a webhook call for testing
   */
  async simulateWebhook(source: string, body: unknown): Promise<void> {
    if (!this.handler) {
      throw new Error('WebhookTrigger not started');
    }

    const event: TriggerEvent = {
      type: 'webhook',
      payload: {
        source,
        body,
        headers: {},
      },
      timestamp: new Date(),
      source,
    };

    await this.handler.onTrigger(event);
  }
}
