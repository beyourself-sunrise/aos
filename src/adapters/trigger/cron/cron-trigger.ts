/**
 * Cron Trigger — implements AOS Trigger interface using croner.
 * OSS implementation: croner (MIT)
 */

import { Cron } from 'croner';
import type { Trigger, TriggerHandler, TriggerEvent, CronTriggerConfig } from '../../../interfaces/trigger';

export class CronTrigger implements Trigger {
  readonly type = 'cron' as const;

  private cronJob: Cron | null = null;
  private handler: TriggerHandler | null = null;

  constructor(private config: CronTriggerConfig) {}

  async start(handler: TriggerHandler): Promise<void> {
    this.handler = handler;
    this.cronJob = new Cron(this.config.schedule, {
      timezone: this.config.timezone ?? 'Asia/Taipei',
    }, async () => {
      if (this.handler) {
        await this.handler.onTrigger({
          type: 'cron',
          payload: this.config.payload,
          timestamp: new Date(),
        });
      }
    });
  }

  async stop(): Promise<void> {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
  }

  /** Fire the cron handler immediately (for testing) */
  async fireNow(): Promise<void> {
    if (this.handler) {
      await this.handler.onTrigger({
        type: 'cron',
        payload: this.config.payload,
        timestamp: new Date(),
      });
    }
  }
}
