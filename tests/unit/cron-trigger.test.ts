import { describe, it, expect } from 'vitest';
import { CronTrigger } from '../../src/adapters/trigger/cron/cron-trigger';
import type { TriggerEvent } from '../../src/interfaces/trigger';

describe('CronTrigger', () => {
  it('should have correct type', () => {
    const trigger = new CronTrigger({
      schedule: '0 9 * * *',
      timezone: 'Asia/Taipei',
      payload: { task: 'test' },
    });
    expect(trigger.type).toBe('cron');
  });

  it('should fire handler on start', async () => {
    const events: TriggerEvent[] = [];
    const trigger = new CronTrigger({
      schedule: '0 9 * * *',
      timezone: 'Asia/Taipei',
      payload: { task: 'test' },
    });

    await trigger.start({
      onTrigger: async (event) => events.push(event),
    });

    await (trigger as any).fireNow();
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('cron');
    expect(events[0].payload).toEqual({ task: 'test' });

    await trigger.stop();
  });

  it('should stop without error', async () => {
    const trigger = new CronTrigger({
      schedule: '0 9 * * *',
      payload: {},
    });
    await trigger.start({ onTrigger: async () => {} });
    await trigger.stop();
    // No error = success
  });
});
