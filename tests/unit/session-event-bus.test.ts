import { describe, it, expect, vi } from 'vitest';
import { KafkaSessionEventBus } from '../../src/adapters/realtime/session-event-bus';

describe('KafkaSessionEventBus', () => {
  it('should construct with defaults', () => {
    const mockKafka = {
      producer: vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        send: vi.fn(),
      })),
    };
    const bus = new KafkaSessionEventBus(mockKafka as any);
    expect(bus).toBeDefined();
  });

  it('should construct with custom topic prefix', () => {
    const mockKafka = {
      producer: vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        send: vi.fn(),
      })),
    };
    const bus = new KafkaSessionEventBus(mockKafka as any, 'custom.prefix.');
    expect(bus).toBeDefined();
  });
});
