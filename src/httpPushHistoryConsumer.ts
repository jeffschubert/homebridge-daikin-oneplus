import type { Logging } from 'homebridge';
import { HistoryConsumer, ThermostatReading } from './types.js';

/** How the configured token is presented to the endpoint. */
export type PushAuthScheme = 'bearer' | 'apiKey' | 'none';

/** Shape of the POST body: `{"readings": [...]}` or a bare JSON array. */
export type PushBodyFormat = 'readings' | 'array';

export interface HttpPushHistoryConsumerOptions {
  url: string; // e.g. http://my-collector.local:8080/api/readings
  token?: string;
  authScheme?: PushAuthScheme; // default 'bearer'
  bodyFormat?: PushBodyFormat; // default 'readings'
  flushIntervalMs?: number; // 0 (the default) posts each reading as it arrives
  maxBuffer?: number; // drop oldest beyond this, default 200
  batchSize?: number; // readings per request, default 100
  requestTimeoutMs?: number; // default 15s
}

const DEFAULT_FLUSH_INTERVAL_MS = 0; // post on arrival
const DEFAULT_MAX_BUFFER = 200;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 60_000; // when posting on arrival, how soon to retry after a failure

/**
 * Posts readings to an HTTP endpoint as JSON, either as each one arrives or
 * batched on an interval. Unsent readings stay buffered on failure so a
 * restart of the receiver doesn't lose data.
 */
export class HttpPushHistoryConsumer implements HistoryConsumer {
  private readonly flushIntervalMs: number;
  private readonly maxBuffer: number;
  private readonly batchSize: number;
  private readonly requestTimeoutMs: number;
  private readonly headers: Record<string, string>;
  private buffer: ThermostatReading[] = [];
  private flushTimer?: NodeJS.Timeout;
  private retryTimer?: NodeJS.Timeout;
  private flushing = false;
  private warnedFailure = false;

  public constructor(
    private readonly log: Logging,
    private readonly options: HttpPushHistoryConsumerOptions,
  ) {
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.headers = this.buildHeaders();

    if (this.flushIntervalMs > 0) {
      this.log.info(
        'HttpPushHistoryConsumer initialized, posting readings to %s every %ds',
        options.url,
        Math.round(this.flushIntervalMs / 1000),
      );
      this.flushTimer = setInterval(() => void this.flush(), this.flushIntervalMs);
    } else {
      this.log.info('HttpPushHistoryConsumer initialized, posting readings to %s as they arrive', options.url);
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = this.options.token?.trim();
    const scheme = this.options.authScheme ?? 'bearer';
    if (token && scheme !== 'none') {
      if (scheme === 'apiKey') {
        headers['X-Api-Key'] = token;
      } else {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }
    return headers;
  }

  public onReading(reading: ThermostatReading): void {
    this.buffer.push(reading);
    // Bound the buffer: if the endpoint is down for a day, keep the newest
    // rather than growing without limit.
    if (this.buffer.length > this.maxBuffer) {
      this.buffer.splice(0, this.buffer.length - this.maxBuffer);
    }
    if (this.flushIntervalMs <= 0) {
      void this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) {
      return;
    }
    this.flushing = true;
    try {
      // Oldest first, in batches — the endpoint may cap how many it accepts per request.
      while (this.buffer.length > 0) {
        const batch = this.buffer.slice(0, this.batchSize);
        const sent = await this.post(batch);
        if (!sent) {
          this.scheduleRetry(); // batch stays buffered until the next attempt
          return;
        }
        this.buffer.splice(0, batch.length);
      }
    } finally {
      this.flushing = false;
    }
  }

  /** Without a flush interval there's no timer to retry on, so a failure arms a one-shot retry rather than waiting for the next reading. */
  private scheduleRetry(): void {
    if (this.flushIntervalMs > 0 || this.retryTimer) {
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.flush();
    }, RETRY_DELAY_MS);
    this.retryTimer.unref?.();
  }

  /** Returns true if the batch was accepted; false leaves it buffered for the next attempt. */
  private async post(batch: ThermostatReading[]): Promise<boolean> {
    const body = (this.options.bodyFormat ?? 'readings') === 'array' ? batch : { readings: batch };
    try {
      const res = await fetch(this.options.url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}: ${(await res.text()).slice(0, 200)}`);
      }
      this.log.debug('Pushed %d readings to %s: %s', batch.length, this.options.url, (await res.text()).slice(0, 200));
      this.warnedFailure = false;
      return true;
    } catch (err) {
      // A batch that partially landed is re-sent whole, so the endpoint should tolerate duplicate readings.
      if (!this.warnedFailure) {
        this.log.warn('Failed to push %d readings to %s, will retry:', batch.length, this.options.url, err);
        this.warnedFailure = true; // don't spam the log while the endpoint stays down
      } else {
        this.log.debug('Push to %s still failing:', this.options.url, err);
      }
      return false;
    }
  }

  public async destroy(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    await this.flush(); // don't lose the last buffered minute
  }
}
