import { describe, it, expect, vi } from 'vitest';
import { RealTimeStreamService } from '../../src/adapters/realtime/realtime-stream-service';
import { SubscriptionRegistry } from '../../src/adapters/realtime/subscription-registry';

describe('RealTimeStreamService', () => {
  it('should construct with dependencies', () => {
    const mockKafka = {
      consumer: vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        subscribe: vi.fn(),
        run: vi.fn(),
      })),
    };
    const mockIo = {
      to: vi.fn().mockReturnThis(),
      emit: vi.fn(),
      on: vi.fn(),
      close: vi.fn(),
    };
    const registry = new SubscriptionRegistry();
    const service = new RealTimeStreamService(mockIo as any, mockKafka as any, registry);
    expect(service).toBeDefined();
  });
});
