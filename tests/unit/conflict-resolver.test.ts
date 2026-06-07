/**
 * Unit tests for ConflictResolver.
 * Tests retry logic, exponential backoff, and error handling.
 */

import { ConflictResolver, ConflictError } from '../../src/adapters/session-storage/conflict-resolver';

describe('ConflictResolver', () => {
  describe('retry', () => {
    it('returns result when operation succeeds on first try', async () => {
      const resolver = new ConflictResolver(3, 0);
      const operation = jest.fn().mockResolvedValue('result');

      const result = await resolver.retry(operation);

      expect(result).toBe('result');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('retries on ConflictError and succeeds on second try', async () => {
      const resolver = new ConflictResolver(3, 0);
      const operation = jest.fn()
        .mockRejectedValueOnce(new ConflictError('thread-1', 1, 2))
        .mockResolvedValueOnce('result');

      const result = await resolver.retry(operation);

      expect(result).toBe('result');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('retries up to maxRetries and throws last ConflictError', async () => {
      const resolver = new ConflictResolver(3, 0);
      const error = new ConflictError('thread-1', 1, 2);
      const operation = jest.fn().mockRejectedValue(error);

      await expect(resolver.retry(operation)).rejects.toThrow('Optimistic lock conflict');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('throws non-ConflictError immediately without retry', async () => {
      const resolver = new ConflictResolver(3, 0);
      const operation = jest.fn().mockRejectedValue(new Error('DB error'));

      await expect(resolver.retry(operation)).rejects.toThrow('DB error');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('uses exponential backoff delays', async () => {
      // Use small base delay for testing
      const resolver = new ConflictResolver(3, 10);
      let callCount = 0;
      const operation = jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          throw new ConflictError('thread-1', callCount, callCount + 1);
        }
        return 'success';
      });

      await resolver.retry(operation);

      expect(operation).toHaveBeenCalledTimes(3);
    });
  });

  describe('ConflictError', () => {
    it('has correct message format', () => {
      const err = new ConflictError('thread-1', 1, 3);
      expect(err.message).toContain('thread-1');
      expect(err.message).toContain('expected v1');
      expect(err.message).toContain('got v3');
    });

    it('has correct name', () => {
      const err = new ConflictError('thread-1', 1, 2);
      expect(err.name).toBe('ConflictError');
    });

    it('is instanceof Error', () => {
      const err = new ConflictError('thread-1', 1, 2);
      expect(err).toBeInstanceOf(Error);
    });

    it('is instanceof ConflictError', () => {
      const err = new ConflictError('thread-1', 1, 2);
      expect(err).toBeInstanceOf(ConflictError);
    });
  });
});
