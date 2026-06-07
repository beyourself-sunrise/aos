/**
 * ConflictResolver — pure-function optimistic lock conflict detection + retry pattern.
 *
 * Usage: inject into PgSessionStorage constructor.
 * All session write operations that need optimistic locking go through this.
 */

/**
 * Thrown when an optimistic lock conflict is detected.
 * The ConflictResolver catches this and retries the operation.
 */
export class ConflictError extends Error {
  constructor(
    public threadId: string,
    public expectedVersion: number,
    public actualVersion: number,
  ) {
    super(
      `Optimistic lock conflict on session ${threadId}: expected v${expectedVersion}, got v${actualVersion}`,
    );
    this.name = 'ConflictError';
  }
}

/**
 * ConflictResolver — handles optimistic lock conflicts with exponential backoff retry.
 *
 * Pure function: no external state, fully testable.
 * Default: 3 retries with 50ms base delay (50/100/200ms).
 */
export class ConflictResolver {
  constructor(
    private maxRetries: number = 3,
    private baseDelayMs: number = 50,
  ) {}

  /**
   * Retry an operation on ConflictError with exponential backoff.
   *
   * @param operation - async function that may throw ConflictError
   * @returns result of the operation
   * @throws last ConflictError if all retries exhausted, or any non-ConflictError immediately
   */
  async retry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (err) {
        if (err instanceof ConflictError) {
          lastError = err;
          // Exponential backoff: baseDelayMs * 2^attempt
          await this.sleep(this.baseDelayMs * Math.pow(2, attempt));
          continue;
        }
        // Non-conflict errors are thrown immediately
        throw err;
      }
    }

    throw lastError ?? new Error('Max retries exceeded');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
