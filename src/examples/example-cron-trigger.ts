/**
 * Example: Daily 9:00 cron trigger
 *
 * Demonstrates AOS Trigger interface + CronTrigger adapter.
 * Agent runs a self-check task when cron fires.
 */

import { CronTrigger } from '../adapters/trigger/cron/cron-trigger';
import { PiAgentAdapter } from '../adapters/agent/pi-agent-adapter';
import type { Session, SessionContext, SessionEntry } from '../interfaces/agent';

/** Mock session for POC */
class MockSession implements Session {
  readonly threadId = 'session-cron-demo';
  private entries: SessionEntry[] = [];

  async getContext(): Promise<SessionContext> {
    return { history: this.entries, metadata: {} };
  }

  async appendEntry(entry: SessionEntry): Promise<void> {
    this.entries.push(entry);
  }
}

export async function runCronTriggerExample(): Promise<void> {
  console.log('[Example] Cron Trigger Demo');

  const trigger = new CronTrigger({
    schedule: '0 9 * * *',
    timezone: 'Asia/Taipei',
    payload: { task: 'daily-self-check' },
  });

  const agent = new PiAgentAdapter({
    id: 'aos-daily-checker',
    name: 'AOS Daily Self-Check',
    description: '每日 9:00 自我檢查',
    systemPrompt: '你是一個 AI 員工；執行每日自我檢查任務。',
  });

  const session = new MockSession();

  await trigger.start({
    onTrigger: async (event) => {
      console.log(`[Cron] Triggered at ${event.timestamp}:`, event.payload);
      const output = await agent.run(
        { prompt: '執行每日自我檢查' },
        session,
      );
      console.log(`[Agent] Result: ${output.response}`);
    },
  });

  // Fire immediately for demo
  await (trigger as any).fireNow();
  console.log('[Example] Cron Trigger Demo complete');
}
