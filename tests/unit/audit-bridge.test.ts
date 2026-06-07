import { describe, it, expect } from 'vitest';
import type { Audit, AuditEvent, AuditFilter } from '../../src/interfaces/audit';

/** In-memory audit for unit testing */
class InMemoryAudit implements Audit {
  private events: AuditEvent[] = [];

  async log(event: AuditEvent): Promise<void> {
    this.events.push({ ...event, createdAt: event.createdAt ?? new Date() });
  }

  async query(filter: AuditFilter): Promise<AuditEvent[]> {
    let results = [...this.events];
    if (filter.type) results = results.filter((e) => e.type === filter.type);
    if (filter.actor) results = results.filter((e) => e.actor === filter.actor);
    if (filter.from) results = results.filter((e) => e.createdAt! >= filter.from!);
    if (filter.to) results = results.filter((e) => e.createdAt! <= filter.to!);
    return results.slice(0, filter.limit ?? 100);
  }
}

describe('Audit (InMemoryAudit)', () => {
  let audit: Audit;

  it('should log and query events', async () => {
    audit = new InMemoryAudit();
    await audit.log({
      id: 'test-1',
      type: 'aos.test.event',
      actor: 'test-actor',
      payload: { data: 'test' },
    });

    const results = await audit.query({ type: 'aos.test.event' });
    expect(results.length).toBe(1);
    expect(results[0].type).toBe('aos.test.event');
  });

  it('should filter by actor', async () => {
    audit = new InMemoryAudit();
    await audit.log({
      id: 'test-2',
      type: 'aos.test.event',
      actor: 'actor-a',
      payload: {},
    });
    await audit.log({
      id: 'test-3',
      type: 'aos.test.event',
      actor: 'actor-b',
      payload: {},
    });

    const results = await audit.query({ actor: 'actor-a' });
    expect(results.length).toBe(1);
    expect(results[0].actor).toBe('actor-a');
  });

  it('should respect limit', async () => {
    audit = new InMemoryAudit();
    for (let i = 0; i < 5; i++) {
      await audit.log({
        id: `test-${i}`,
        type: 'aos.test.event',
        actor: 'test',
        payload: {},
      });
    }

    const results = await audit.query({ limit: 2 });
    expect(results.length).toBe(2);
  });
});
