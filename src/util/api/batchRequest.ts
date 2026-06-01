/**
 * Batch Request Utility
 *
 * Efficiently batch multiple API requests to reduce network overhead.
 *
 * Features:
 * - Automatic batching of requests within a time window
 * - Request deduplication (same key only fetched once)
 * - Configurable batch size and delay
 * - Priority-based ordering
 *
 * @example
 * ```typescript
 * const batcher = new BatchRequestManager({
 *   batchSize: 5,
 *   batchDelay: 50,
 * });
 *
 * const result = await batcher.add(
 *   'repo-123',
 *   () => gitApi.getGitStatus({ repo_id: 'repo-123' }),
 *   { priority: 10 }
 * );
 * ```
 */

// ============================================
// Types
// ============================================

export interface BatchRequestOptions {
  /** Maximum requests per batch */
  batchSize?: number;
  /** Delay before executing batch (ms) */
  batchDelay?: number;
  /** Maximum time to wait for batch (ms) */
  maxWaitTime?: number;
}

export interface RequestItem<T> {
  /** Unique key for deduplication */
  key: string;
  /** Function that performs the request */
  fetcher: () => Promise<T>;
  /** Priority (higher = executed first) */
  priority: number;
  /** Timestamp when request was added */
  addedAt: number;
  /** Promise resolve/reject callbacks */
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

// ============================================
// Batch Request Manager
// ============================================

/**
 * Manages batching of API requests for optimal performance
 */
export class BatchRequestManager<T = unknown> {
  private readonly batchSize: number;
  private readonly batchDelay: number;
  private readonly maxWaitTime: number;

  private queue: Map<string, RequestItem<T>> = new Map();
  private batchTimer: NodeJS.Timeout | null = null;
  private inFlight: Set<string> = new Set();

  constructor(options: BatchRequestOptions = {}) {
    this.batchSize = options.batchSize ?? 5;
    this.batchDelay = options.batchDelay ?? 50;
    this.maxWaitTime = options.maxWaitTime ?? 1000;
  }

  /**
   * Add a request to the batch queue
   *
   * @param key Unique identifier for request (for deduplication)
   * @param fetcher Function that performs the API call
   * @param priority Priority level (higher = executed first, default: 0)
   * @returns Promise that resolves with the API response
   */
  async add(
    key: string,
    fetcher: () => Promise<T>,
    options: { priority?: number } = {}
  ): Promise<T> {
    const priority = options.priority ?? 0;

    // Check if already in flight
    if (this.inFlight.has(key)) {
      // Wait for in-flight request to complete
      const existing = this.queue.get(key);
      if (existing) {
        return new Promise((resolve, reject) => {
          existing.resolve = resolve;
          existing.reject = reject;
        });
      }
    }

    // Check if already queued - return existing promise
    const existing = this.queue.get(key);
    if (existing) {
      return new Promise((resolve, reject) => {
        existing.resolve = resolve;
        existing.reject = reject;
      });
    }

    // Create new request item
    return new Promise<T>((resolve, reject) => {
      this.queue.set(key, {
        key,
        fetcher,
        priority,
        addedAt: Date.now(),
        resolve,
        reject,
      });

      // Schedule batch execution
      this.scheduleBatch();
    });
  }

  /**
   * Schedule batch execution
   */
  private scheduleBatch(): void {
    // Clear existing timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    // Check if we should execute immediately
    const shouldExecuteNow =
      this.queue.size >= this.batchSize ||
      this.hasOldestRequestExceededMaxWait();

    if (shouldExecuteNow) {
      this.executeBatch();
    } else {
      // Schedule batch after delay
      this.batchTimer = setTimeout(() => {
        this.executeBatch();
      }, this.batchDelay);
    }
  }

  /**
   * Check if oldest request has exceeded max wait time
   */
  private hasOldestRequestExceededMaxWait(): boolean {
    if (this.queue.size === 0) return false;

    const now = Date.now();
    for (const item of this.queue.values()) {
      if (now - item.addedAt >= this.maxWaitTime) {
        return true;
      }
    }
    return false;
  }

  /**
   * Execute current batch
   */
  private async executeBatch(): Promise<void> {
    if (this.queue.size === 0) return;

    // Clear timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // Get items to process (up to batchSize)
    const items = Array.from(this.queue.values())
      .sort((a, b) => {
        // Sort by priority (high to low), then by age (old to new)
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        return a.addedAt - b.addedAt;
      })
      .slice(0, this.batchSize);

    // Remove from queue and mark as in flight
    items.forEach((item) => {
      this.queue.delete(item.key);
      this.inFlight.add(item.key);
    });
    // Execute all requests in parallel
    await Promise.allSettled(
      items.map(async (item) => {
        try {
          const result = await item.fetcher();
          item.resolve(result);
        } catch (error) {
          item.reject(error);
        } finally {
          this.inFlight.delete(item.key);
        }
      })
    );

    // If there are more items in queue, schedule next batch
    if (this.queue.size > 0) {
      this.scheduleBatch();
    }
  }

  /**
   * Clear all pending requests
   */
  clear(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // Reject all pending requests
    for (const item of this.queue.values()) {
      item.reject(new Error("Batch request cancelled"));
    }

    this.queue.clear();
    this.inFlight.clear();
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    queueSize: number;
    inFlightSize: number;
    oldestWaitTime: number | null;
  } {
    const now = Date.now();
    let oldestWaitTime: number | null = null;

    if (this.queue.size > 0) {
      const oldest = Math.min(
        ...Array.from(this.queue.values()).map((item) => item.addedAt)
      );
      oldestWaitTime = now - oldest;
    }

    return {
      queueSize: this.queue.size,
      inFlightSize: this.inFlight.size,
      oldestWaitTime,
    };
  }
}

// ============================================
// Shared Instance for Git Status Requests
// ============================================

/**
 * Shared batch manager for git status requests
 * Optimized for parallel repo status fetching
 *
 * FIXED (Jan 21, 2026): Reduced batchSize from 10 → 2
 * Prevents "bad file descriptor" errors by coordinating with
 * MAX_CONCURRENT limits in GitStatusContext and MultiRepoGitStatusContext.
 * See: Documentation/Development/startup-bad-descriptor-investigation-0121.md
 */
export const gitStatusBatchManager = new BatchRequestManager({
  batchSize: 2, // ✅ Align with MAX_CONCURRENT_GIT_OPERATIONS (was 10)
  batchDelay: 100, // Wait 100ms to collect requests
  maxWaitTime: 500, // Never wait more than 500ms
});
