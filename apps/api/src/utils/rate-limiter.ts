/**
 * Rate limiter utility for API calls
 * Prevents hitting rate limits by controlling request frequency
 */

import { Logger } from '@nestjs/common';

export interface RateLimiterOptions {
  /** Maximum requests per minute */
  maxRequestsPerMinute: number;
  /** Maximum concurrent requests */
  maxConcurrent: number;
  /** Name for logging purposes */
  name?: string;
}

interface QueuedRequest {
  resolve: () => void;
  reject: (error: Error) => void;
  timestamp: number;
}

export class RateLimiter {
  private readonly logger: Logger;
  private requestTimestamps: number[] = [];
  private currentConcurrent = 0;
  private queue: QueuedRequest[] = [];
  private readonly maxRequestsPerMinute: number;
  private readonly maxConcurrent: number;

  constructor(options: RateLimiterOptions) {
    this.maxRequestsPerMinute = options.maxRequestsPerMinute;
    this.maxConcurrent = options.maxConcurrent;
    this.logger = new Logger(`RateLimiter:${options.name || 'default'}`);
  }

  /**
   * Execute a function with rate limiting
   * Will queue the request if rate limit or concurrency limit is reached
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Wait for available slot
    await this.waitForSlot();

    this.currentConcurrent++;
    this.requestTimestamps.push(Date.now());

    try {
      return await fn();
    } finally {
      this.currentConcurrent--;
      this.processQueue();
    }
  }

  /**
   * Get current rate limiter status
   */
  getStatus(): {
    currentConcurrent: number;
    requestsInLastMinute: number;
    queueLength: number;
  } {
    this.cleanOldTimestamps();
    return {
      currentConcurrent: this.currentConcurrent,
      requestsInLastMinute: this.requestTimestamps.length,
      queueLength: this.queue.length,
    };
  }

  private async waitForSlot(): Promise<void> {
    // Check concurrent limit first
    if (this.currentConcurrent >= this.maxConcurrent) {
      this.logger.debug(
        `Concurrent limit reached (${this.currentConcurrent}/${this.maxConcurrent}), queuing request`,
      );
      await new Promise<void>((resolve, reject) => {
        this.queue.push({ resolve, reject, timestamp: Date.now() });
      });
    }

    // Check rate limit (requests per minute)
    await this.waitForRateLimit();
  }

  private async waitForRateLimit(): Promise<void> {
    this.cleanOldTimestamps();

    if (this.requestTimestamps.length >= this.maxRequestsPerMinute) {
      // Calculate wait time until oldest request expires
      const oldestTimestamp = this.requestTimestamps[0];
      const now = Date.now();
      const waitTime = oldestTimestamp + 60000 - now + 100; // Add 100ms buffer

      if (waitTime > 0) {
        this.logger.log(
          `Rate limit reached (${this.requestTimestamps.length}/${this.maxRequestsPerMinute} RPM), ` +
            `waiting ${Math.round(waitTime / 1000)}s`,
        );
        await this.sleep(waitTime);
        // Clean again after waiting
        this.cleanOldTimestamps();
      }
    }
  }

  private cleanOldTimestamps(): void {
    const oneMinuteAgo = Date.now() - 60000;
    this.requestTimestamps = this.requestTimestamps.filter(t => t > oneMinuteAgo);
  }

  private processQueue(): void {
    if (this.queue.length > 0 && this.currentConcurrent < this.maxConcurrent) {
      const next = this.queue.shift();
      if (next) {
        // Check if request has been waiting too long (5 minutes)
        if (Date.now() - next.timestamp > 5 * 60 * 1000) {
          next.reject(new Error('Request timed out in rate limiter queue'));
          // Process next item
          this.processQueue();
        } else {
          next.resolve();
        }
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Cancel all queued requests
   */
  cancelAll(): void {
    const queueCopy = [...this.queue];
    this.queue = [];
    for (const request of queueCopy) {
      request.reject(new Error('Rate limiter cancelled'));
    }
  }
}

/**
 * Create a shared rate limiter instance
 * Useful for services that need to share rate limits
 */
const rateLimiters = new Map<string, RateLimiter>();

export function getOrCreateRateLimiter(
  name: string,
  options: RateLimiterOptions,
): RateLimiter {
  if (!rateLimiters.has(name)) {
    rateLimiters.set(name, new RateLimiter({ ...options, name }));
  }
  return rateLimiters.get(name)!;
}
