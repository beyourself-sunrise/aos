/**
 * Slack Trigger — implements AOS Trigger interface using @slack/bolt Socket Mode.
 * OSS implementation: @slack/bolt (MIT)
 *
 * Listens for Slack events (DM mentions, channel @AOS mentions, app_mention)
 * and forwards them to the TriggerHandler.
 *
 * License verified: @slack/bolt is MIT licensed.
 */

import { App } from '@slack/bolt';
import type { Trigger, TriggerHandler, TriggerEvent, SlackTriggerConfig } from '../../../interfaces/trigger';

export interface SlackTriggerOptions {
  /** Slack Bot Token (xoxb-...) */
  botToken: string;
  /** Slack App Token (xapp-...) for Socket Mode */
  appToken: string;
  /** Channels to monitor (optional, empty = all) */
  channels?: string[];
  /** AOS bot mention name for filtering */
  botName?: string;
}

export class SlackTrigger implements Trigger {
  readonly type = 'slack' as const;

  private app: App | null = null;
  private handler: TriggerHandler | null = null;
  private botName: string;
  private running = false;

  constructor(private config: SlackTriggerOptions) {
    this.botName = config.botName ?? 'AOS';
  }

  async start(handler: TriggerHandler): Promise<void> {
    if (this.running) {
      return;
    }
    this.handler = handler;
    this.running = true;

    this.app = new App({
      token: this.config.botToken,
      appToken: this.config.appToken,
      socketMode: true,
    });

    // Listen for app_mention (e.g., @AOS in a channel)
    this.app.event('app_mention', async ({ event }) => {
      await this.handleEvent(event as unknown as Record<string, unknown>, 'app_mention');
    });

    // Listen for DM messages to the bot
    this.app.event('message', async ({ event }) => {
      // Only handle DMs (im type) or direct mentions
      const evt = event as unknown as Record<string, unknown>;
      if (evt.channel_type === 'im') {
        await this.handleEvent(evt, 'message.im');
      }
    });

    await this.app.start();
    console.log(`[SlackTrigger] Started in Socket Mode, monitoring for @${this.botName} mentions`);
  }

  async stop(): Promise<void> {
    if (!this.running || !this.app) {
      return;
    }
    this.running = false;
    await this.app.stop();
    this.app = null;
    console.log('[SlackTrigger] Stopped');
  }

  private async handleEvent(
    event: Record<string, unknown>,
    eventType: string,
  ): Promise<void> {
    if (!this.handler || !this.running) {
      return;
    }

    const text = (event.text as string) ?? '';
    const channel = event.channel as string;
    const user = event.user as string;
    const ts = event.ts as string;

    const triggerEvent: TriggerEvent = {
      type: 'slack',
      payload: {
        eventType,
        text,
        channel,
        user,
        ts,
        botName: this.botName,
      },
      timestamp: new Date(),
      source: `slack:${channel}`,
    };

    try {
      await this.handler.onTrigger(triggerEvent);
    } catch (err) {
      console.error(`[SlackTrigger] Handler error for ${eventType}:`, err);
    }
  }

  /**
   * Simulate a Slack event for testing (bypasses real Slack connection)
   */
  async simulateEvent(event: {
    type: 'app_mention' | 'message.im';
    text: string;
    channel: string;
    user: string;
  }): Promise<void> {
    if (!this.handler) {
      throw new Error('SlackTrigger not started');
    }

    const triggerEvent: TriggerEvent = {
      type: 'slack',
      payload: {
        eventType: event.type,
        text: event.text,
        channel: event.channel,
        user: event.user,
        ts: Date.now().toString(),
        botName: this.botName,
      },
      timestamp: new Date(),
      source: `slack:${event.channel}`,
    };

    await this.handler.onTrigger(triggerEvent);
  }
}
